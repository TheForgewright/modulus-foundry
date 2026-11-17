/**
 * GM-side encounter controller (§14). The GM client owns the state machine; players only
 * answer queries. Every step can be overridden from the Encounter Manager: declare on a
 * player's behalf, pass, force-confirm, skip a Duelist, interrupt.
 */
import { SYSTEM_ID } from "../config.js";
import * as E from "../rules/encounter.js";
import { getSetting } from "../settings.js";
import { declarationFromPayload } from "./declaration.js";
import { resolveDeclaration } from "../apps/action-builder.js";
import { applyAllOutcomes } from "./outcomes.js";

const QUERY_TIMEOUT = 30 * 60 * 1000;
const rng = () => CONFIG.Dice.randomUniform();
const controllers = new Map();

export function encounterController(combat) {
  let c = controllers.get(combat.id);
  if (!c) controllers.set(combat.id, (c = new EncounterController(combat)));
  return c;
}

function engineSettings() {
  return { cascadeDepthCap: getSetting("cascadeDepthCap"), chargeResolvesOn: getSetting("chargeResolvesOn") };
}

export class EncounterController {
  constructor(combat) {
    this.combat = combat;
    /** Outstanding player queries, by step key. Not persisted: after a reload the GM re-sends. */
    this.asked = new Map();
    this._chain = Promise.resolve();
  }

  get state() {
    return this.combat.encounterState;
  }

  /** Serialize state changes so overlapping answers cannot interleave. */
  run(fn) {
    const next = this._chain.then(fn, fn);
    this._chain = next.catch((err) => {
      console.error("Modulus | encounter", err);
      ui.notifications.error(err.message);
    });
    return next;
  }

  async save(state) {
    await this.combat.saveEncounterState(state);
  }

  combatant(pid) {
    return this.combat.combatants.get(pid);
  }

  async chat(content) {
    return ChatMessage.create({
      content: `<div class="modulus-encounter-note"><strong>${foundry.utils.escapeHTML(this.combat.label)}</strong><p>${content}</p></div>`,
      speaker: { alias: game.i18n.localize("MODULUS.Encounter.Speaker") }
    });
  }

  /* -------------------------------------------- */
  /*  Round start and participation               */
  /* -------------------------------------------- */

  startRound() {
    return this.run(async () => {
      if (!this.combat.started) await this.combat.startCombat();
      const participants = this.combat.combatants.map((c) => ({
        id: c.id,
        momentum: c.momentum,
        gain: c.actor?.system.momentum.gainPerTurn ?? getSetting("momentum.gainDefault"),
        ceiling: c.actor?.system.momentum.ceiling ?? 99
      }));
      const { state, gains } = E.startRound(this.state, participants);
      for (const [pid, value] of Object.entries(gains)) await this.combatant(pid)?.setMomentum(value);
      await this.tickStatuses("roundStart");
      this.asked.clear();
      await this.save(state);
      await this.requestParticipation();
    });
  }

  /** Ask each player which of their characters take part (non-blocking). */
  async requestParticipation() {
    const byUser = new Map();
    for (const c of this.combat.combatants) {
      const owner = c.playerOwners[0];
      if (!owner) continue;
      if (!byUser.has(owner)) byUser.set(owner, []);
      byUser.get(owner).push(c.id);
    }
    for (const [user, ids] of byUser) {
      const key = `participation:${user.id}:${this.state.round}`;
      if (this.asked.has(key)) continue;
      this.asked.set(key, user.id);
      user.query(`${SYSTEM_ID}.participation`, { combatId: this.combat.id, combatantIds: ids }, { timeout: QUERY_TIMEOUT })
        .then((answer) => this.onParticipation(answer))
        .catch(() => null)
        .finally(() => this.asked.delete(key));
    }
  }

  async onParticipation(answer) {
    if (!answer || this.state.phase !== "participation") return;
    for (const [id, a] of Object.entries(answer)) {
      const c = this.combatant(id);
      if (!c) continue;
      await c.setFlag(SYSTEM_ID, "active", Boolean(a.active));
      if (Number.isFinite(a.momentum) && a.momentum !== c.momentum) await c.setMomentum(a.momentum);
      if (typeof a.sceneTrack === "string") await c.setFlag(SYSTEM_ID, "sceneTrack", a.sceneTrack);
    }
  }

  setParticipating(combatantId, active) {
    return this.combatant(combatantId)?.setFlag(SYSTEM_ID, "active", active);
  }

  /** Close participation, fix order (rolloffs), and start declaring. */
  beginDeclarations() {
    return this.run(async () => {
      if (this.state.phase !== "participation") return;
      const active = this.combat.combatants.filter((c) => c.participating && !c.defeated)
        .map((c) => ({ id: c.id, name: c.name, momentum: c.momentum }));
      const { state, rolloffs } = E.beginDeclaration(this.state, active, rng);
      await this.save(state);
      for (const r of rolloffs) {
        await this.chat(game.i18n.format("MODULUS.Encounter.Rolloff", {
          rolls: r.pids.map((p) => `${state.names[p]} ${r.rolls[p]}`).join(", ")
        }));
      }
      await this._pump();
    });
  }

  /* -------------------------------------------- */
  /*  Driving prompts                              */
  /* -------------------------------------------- */

  pump() {
    return this.run(() => this._pump());
  }

  async _pump() {
    for (let guard = 0; guard < 50; guard++) {
      let s = this.state;
      if (s.phase === "declaring") {
        const step = E.nextStep(s);
        if (step.type === "done") {
          await this.save(E.beginFinalization(s).state);
          continue;
        }
        return this.ask(step);
      }
      if (s.phase === "finalization") {
        if (!s.duelistQueue.length) {
          await this.save(E.beginExecution(s, rng).state);
          if (getSetting("autoApplyOutcomes")) return; // the GM still presses Resolve per entry
          return;
        }
        return this.ask({ type: "duelist", entryId: s.duelistQueue[0] });
      }
      return;
    }
  }

  /** Who should answer a step, and the key identifying it. */
  stepInfo(step, s = this.state) {
    const entry = step.entryId ? s.stack.find((e) => e.id === step.entryId) : null;
    const pid = step.pid ?? entry?.pid;
    const combatant = this.combatant(pid);
    return { pid, entry, combatant, owner: combatant?.playerOwners[0] ?? null, key: `${s.round}:${step.type}:${step.entryId ?? pid}:${s.seq}` };
  }

  /** Send the step to its player, unless already asked. NPC steps wait for the GM in the manager. */
  ask(step, { force = false } = {}) {
    const s = this.state;
    const info = this.stepInfo(step, s);
    if (!info.owner) return;
    if (this.asked.has(info.key) && !force) return;
    this.asked.set(info.key, info.owner.id);
    let data = { combatId: this.combat.id, combatantId: info.pid };
    if (step.type === "reconfirm") {
      data = { ...data, entryId: step.entryId, prefill: info.entry.decl.payload, cause: s.names[step.causePid] ?? "" };
    } else if (step.type === "duelist") {
      data = { ...data, entryId: step.entryId, max: info.entry.decl.duelist };
    } else if (step.type === "declare") {
      // Charge (§7.7): offer to keep charging; declaring anything else resets the counter.
      const charge = s.memory[info.pid]?.charge;
      if (charge?.payload && charge.lastRound === s.round - 1) {
        data.prefill = charge.payload;
        data.note = game.i18n.format("MODULUS.Encounter.ContinueCharging", { label: charge.label, n: charge.count });
      }
    }
    info.owner.query(`${SYSTEM_ID}.${step.type}`, data, { timeout: QUERY_TIMEOUT })
      .then((answer) => this.onAnswer(step, info.key, answer))
      .catch((err) => {
        console.warn("Modulus | query", err);
        this.asked.delete(info.key);
      });
  }

  /** A player's answer arrives. Ignored if the GM already moved past that step. */
  async onAnswer(step, key, answer) {
    this.asked.delete(key);
    if (!answer) return; // dialog closed: the GM can re-send or act on their behalf
    const current = this.stepInfo(this.currentStep() ?? {}, this.state);
    if (current.key !== key) return;
    if (step.type === "declare") return this.submitDeclaration(step.pid, answer);
    if (step.type === "reconfirm") return this.submitReconfirm(step.entryId, answer);
    if (step.type === "duelist") return this.submitDuelist(step.entryId, answer.drop);
  }

  /** The step the encounter is waiting on, if any. */
  currentStep() {
    const s = this.state;
    if (s.phase === "declaring") {
      const step = E.nextStep(s);
      return step?.type === "done" ? null : step;
    }
    if (s.phase === "finalization" && s.duelistQueue.length) return { type: "duelist", entryId: s.duelistQueue[0] };
    return null;
  }

  /** Text for the manager: who the encounter is waiting on. */
  waitingOn() {
    const step = this.currentStep();
    if (!step) return null;
    const info = this.stepInfo(step);
    return {
      step,
      name: info.combatant?.name ?? "?",
      player: info.owner?.name ?? null,
      asked: this.asked.has(info.key),
      cause: step.causePid ? this.state.names[step.causePid] : null
    };
  }

  /* -------------------------------------------- */
  /*  Answers (from players or the GM)             */
  /* -------------------------------------------- */

  submitDeclaration(pid, answer) {
    return this.run(async () => {
      const s = this.state;
      const step = E.nextStep(s);
      if (step?.type !== "declare" || step.pid !== pid) return;
      if (answer.type === "pass") {
        await this.save(E.pass(s, pid).state);
        return this._pump();
      }
      const combatant = this.combatant(pid);
      const { decl, errors } = await declarationFromPayload(this.combat, combatant, answer.payload);
      if (errors.length || !decl) return this.reject(pid, errors);
      if (answer.payload.sceneTrack && answer.payload.sceneTrack !== combatant.sceneTrack) {
        await combatant.setFlag(SYSTEM_ID, "sceneTrack", answer.payload.sceneTrack);
      }
      const r = E.declare(s, pid, decl, rng, engineSettings());
      if (r.errors.length) return this.reject(pid, r.errors.map((e) => game.i18n.format(`MODULUS.Encounter.Error.${e.code}`, e)));
      await this.save(r.state);
      if (r.prompted.length) {
        await this.chat(game.i18n.format("MODULUS.Encounter.Cascade", {
          name: combatant.name, names: r.prompted.map((id) => r.state.stack.find((e) => e.id === id).name).join(", ")
        }));
      }
      return this._pump();
    });
  }

  async reject(pid, errors) {
    const name = this.combatant(pid)?.name ?? "?";
    ui.notifications.warn(game.i18n.format("MODULUS.Encounter.Rejected", { name, errors: errors.join(" ") }));
    // Ask again; the player sees the same validation in their dialog.
    const step = this.currentStep();
    if (step) this.ask(step, { force: true });
  }

  submitReconfirm(entryId, answer) {
    return this.run(async () => {
      const s = this.state;
      if (!s.queue.some((q) => q.entryId === entryId)) return;
      if (answer.type === "keep") {
        await this.save(E.reconfirm(s, entryId, null).state);
        return this._pump();
      }
      const entry = s.stack.find((e) => e.id === entryId);
      const combatant = this.combatant(entry.pid);
      const { decl, errors } = await declarationFromPayload(this.combat, combatant, answer.payload);
      if (errors.length || !decl) return this.reject(entry.pid, errors);
      const r = E.reconfirm(s, entryId, decl, rng, engineSettings());
      if (r.errors.length) return this.reject(entry.pid, r.errors.map((e) => game.i18n.format(`MODULUS.Encounter.Error.${e.code}`, e)));
      await this.save(r.state);
      if (r.prompted.length) {
        await this.chat(game.i18n.format("MODULUS.Encounter.Cascade", {
          name: combatant.name, names: r.prompted.map((id) => r.state.stack.find((e) => e.id === id).name).join(", ")
        }));
      }
      return this._pump();
    });
  }

  forceConfirm(entryId) {
    return this.submitReconfirm(entryId, { type: "keep" });
  }

  submitDuelist(entryId, drop) {
    return this.run(async () => {
      const r = E.applyDuelist(this.state, entryId, drop);
      if (r.errors?.length) return;
      await this.save(r.state);
      return this._pump();
    });
  }

  /* -------------------------------------------- */
  /*  Execution                                    */
  /* -------------------------------------------- */

  resolveNext() {
    return this.run(async () => {
      const entry = E.currentEntry(this.state);
      if (entry) await this._resolve(entry.id);
    });
  }

  async _resolve(entryId) {
    const s = this.state;
    const entry = s.stack.find((e) => e.id === entryId);
    const combatant = this.combatant(entry.pid);
    let hit = null;
    if (entry.state === "CHARGING") {
      await this.chat(game.i18n.format("MODULUS.Encounter.Charging", { name: entry.name, label: entry.decl.label, n: entry.chargeCount, of: entry.decl.charge }));
    } else if (combatant?.actor) {
      // DC and dice are looked up now, at resolution (§6.6 step 7); affordability was checked at declaration.
      const { plan } = await declarationFromPayload(this.combat, combatant, entry.decl.payload, {
        momentum: Number.MAX_SAFE_INTEGER, extraDice: entry.mods, extraFlat: entry.duelistBonus
      });
      if (plan) {
        const res = await resolveDeclaration(combatant.actor, plan, { encounter: { combatId: this.combat.id, entryId } });
        hit = res.hit;
        if (getSetting("autoApplyOutcomes") && res.message) await applyAllOutcomes(res.message);
      }
    }
    const r = E.resolveEntry(this.state, entryId, { hit });
    if (r.momentumChange && combatant) await combatant.adjustMomentum(r.momentumChange);
    await this.save(r.state);
  }

  interrupt(entryId) {
    return this.run(async () => {
      const r = E.cancelEntry(this.state, entryId);
      await this.save(r.state);
      return this._pump();
    });
  }

  /** Surrender decision (§7.9): the GM marks a participant as yielding or out. */
  async setOut(combatantId, out) {
    const c = this.combatant(combatantId);
    if (!c) return;
    await c.update({ defeated: out, [`flags.${SYSTEM_ID}.active`]: !out });
  }

  endRound() {
    return this.run(async () => {
      const r = E.endRound(this.state);
      await this.tickStatuses("roundEnd");
      this.asked.clear();
      await this.save(r.state);
    });
  }

  /* -------------------------------------------- */
  /*  Statuses                                     */
  /* -------------------------------------------- */

  /**
   * Tick status durations on participants (§6.5). "untilNextTurn" clears at the next round
   * start; "rounds:n" counts down at each round end. Statuses live on the character, so a
   * character in two running encounters ticks in both [OPEN].
   */
  async tickStatuses(when) {
    for (const c of this.combat.combatants) {
      const actor = c.actor;
      if (!actor) continue;
      const remove = [];
      const update = [];
      for (const s of actor.items.filter((i) => i.type === "status")) {
        const d = s.system.duration;
        if (when === "roundStart" && d.type === "untilNextTurn" && (s.getFlag(SYSTEM_ID, "appliedRound") ?? -1) < this.state.round) remove.push(s.id);
        if (when === "roundEnd" && d.type === "rounds") {
          if (d.rounds <= 1) remove.push(s.id);
          else update.push({ _id: s.id, "system.duration.rounds": d.rounds - 1 });
        }
      }
      if (remove.length) await actor.deleteEmbeddedDocuments("Item", remove);
      if (update.length) await actor.updateEmbeddedDocuments("Item", update);
    }
  }

  /** Encounter-duration statuses end with the encounter. */
  async endEncounterStatuses() {
    for (const c of this.combat.combatants) {
      const ids = c.actor?.items.filter((i) => i.type === "status" && i.system.duration.type === "encounter").map((i) => i.id) ?? [];
      if (ids.length) await c.actor.deleteEmbeddedDocuments("Item", ids);
    }
  }
}
