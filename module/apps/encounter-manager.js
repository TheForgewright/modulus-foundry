/**
 * Encounter Manager (§14). One window for every running encounter instance: create, round
 * controls, participants (momentum, participation, scene track), the stack drawn top to
 * bottom as it will resolve, what the encounter is waiting on, and the surrender check.
 * GMs drive it; players get the same view read-only, with their own momentum editable.
 */
import { SYSTEM_ID } from "../config.js";
import { resolutionOrder, nextStep, surrenderFlags, currentEntry } from "../rules/encounter.js";
import { ENCOUNTER_KINDS } from "../documents/combat.js";
import { encounterController } from "../encounter/controller.js";
import { ActionBuilder } from "./action-builder.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class EncounterManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modulus-encounter-manager",
    classes: ["modulus", "encounter-manager"],
    window: { title: "MODULUS.Encounter.Manager", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 980, height: 720 },
    actions: {
      select: EncounterManager.#onSelect,
      create: EncounterManager.#onCreate,
      addTokens: EncounterManager.#onAddTokens,
      removeCombatant: EncounterManager.#onRemoveCombatant,
      deleteEncounter: EncounterManager.#onDeleteEncounter,
      startRound: EncounterManager.#onStartRound,
      resendParticipation: EncounterManager.#onResendParticipation,
      beginDeclarations: EncounterManager.#onBeginDeclarations,
      resend: EncounterManager.#onResend,
      actForThem: EncounterManager.#onActForThem,
      passForThem: EncounterManager.#onPassForThem,
      forceConfirm: EncounterManager.#onForceConfirm,
      skipDuelist: EncounterManager.#onSkipDuelist,
      resolveNext: EncounterManager.#onResolveNext,
      interrupt: EncounterManager.#onInterrupt,
      setOut: EncounterManager.#onSetOut,
      endRound: EncounterManager.#onEndRound,
      openSheet: EncounterManager.#onOpenSheet
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/encounter-manager.hbs`, scrollable: [".em-list", ".em-main"] }
  };

  static open(combatId) {
    this._instance ??= new this();
    if (combatId) this._instance.selectedId = combatId;
    this._instance.render({ force: true });
    return this._instance;
  }

  selectedId = null;
  #hooks = [];

  get encounters() {
    return game.combats.filter((c) => game.user.isGM || c.combatants.some((x) => x.actor?.isOwner) || c.visible);
  }

  get combat() {
    const list = this.encounters;
    return list.find((c) => c.id === this.selectedId) ?? list[0] ?? null;
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    const combat = this.combat;
    const isGM = game.user.isGM;
    const ctx = {
      isGM,
      encounters: this.encounters.map((c) => ({
        id: c.id,
        label: c.label,
        kind: t(`MODULUS.Encounter.Kind.${c.kind}`),
        round: c.encounterState.round,
        phase: t(`MODULUS.Encounter.Phase.${c.encounterState.phase}`),
        persistent: c.persistent,
        parent: c.parentId ? game.combats.get(c.parentId)?.label : null,
        selected: c === combat
      })),
      combat: null
    };
    if (!combat) return ctx;
    const s = combat.encounterState;
    const controller = isGM ? encounterController(combat) : null;
    const step = nextStep(s);
    const current = currentEntry(s);
    const tracks = { "": "—", physical: t("MODULUS.Domain.physical"), mental: t("MODULUS.Domain.mental"), social: t("MODULUS.Domain.social") };
    const declared = new Set(s.stack.map((e) => e.pid));

    const waiting = controller?.waitingOn() ?? (step && step.type !== "done" ? { step, name: s.names[step.pid] ?? s.stack.find((e) => e.id === step.entryId)?.name } : null);
    if (waiting) Object.assign(waiting, { isDeclare: waiting.step.type === "declare", isReconfirm: waiting.step.type === "reconfirm", isDuelist: waiting.step.type === "duelist" });
    ctx.combat = {
      id: combat.id,
      label: combat.label,
      kind: t(`MODULUS.Encounter.Kind.${combat.kind}`),
      persistent: combat.persistent,
      round: s.round,
      phase: s.phase,
      phaseLabel: t(`MODULUS.Encounter.Phase.${s.phase}`),
      is: Object.fromEntries(["idle", "participation", "declaring", "finalization", "executing", "surrender"].map((p) => [p, s.phase === p])),
      waiting,
      current: current && { id: current.id, name: current.name, label: current.decl.label },
      participants: combat.combatants.map((c) => {
        const actor = c.actor;
        const flags = s.phase === "surrender" ? surrenderFlags({
          defeatedTracks: actor?.system.defeatedTracks ?? 0, momentum: c.momentum, allDepleted: actor?.system.allDepleted
        }) : [];
        const mem = s.memory[c.id];
        return {
          id: c.id,
          name: c.name,
          img: c.img,
          momentum: c.momentum,
          canEdit: isGM || c.isOwner,
          participating: c.participating,
          defeated: c.defeated,
          sceneTrack: c.sceneTrack,
          sceneTracks: tracks,
          order: s.order.indexOf(c.id) + 1 || null,
          roll: s.rolls[c.id] ?? null,
          declared: declared.has(c.id),
          next: step?.type === "declare" && step.pid === c.id,
          flags: flags.map((f) => t(`MODULUS.Encounter.Flag.${f}`)),
          taxing: mem?.taxing || 0,
          charge: mem?.charge?.count || 0,
          inevitable: mem?.inevitable?.count || 0,
          player: c.playerOwners[0]?.name ?? null
        };
      }).sort((a, b) => (b.momentum - a.momentum) || a.name.localeCompare(b.name)),
      stack: [...resolutionOrder(s), ...s.stack.filter((e) => e.cancelled)].map((e) => ({
        id: e.id,
        name: e.name,
        label: e.decl.label,
        tags: e.decl.tags,
        state: e.state,
        stateLabel: t(`MODULUS.Encounter.State.${e.state}`),
        momentum: e.momentum,
        slow: e.slow,
        fast: e.fast,
        duelist: e.duelistBonus,
        effective: e.effective,
        cost: e.decl.cost,
        target: this.#targetLabel(combat, e),
        charge: e.state === "CHARGING" ? `${e.chargeCount}/${e.decl.charge}` : null,
        mods: e.mods.buff || e.mods.debuff ? `${e.mods.buff ? `+${e.mods.buff}▲` : ""}${e.mods.debuff ? ` +${e.mods.debuff}▼` : ""}` : "",
        delayed: e.delayed,
        cancelled: e.cancelled,
        resolved: e.resolved,
        outcome: e.outcome ? t(`MODULUS.Encounter.Outcome.${e.outcome}`) : "",
        isCurrent: current?.id === e.id,
        prompted: s.queue.some((q) => q.entryId === e.id)
      })),
      log: s.log.slice(-8).reverse().map((l) => this.#logLine(s, l))
    };
    return ctx;
  }

  #targetLabel(combat, entry) {
    const target = entry.decl.target;
    if (!target || target.kind === "none") return "";
    if (target.kind === "self") return game.i18n.localize("MODULUS.Builder.Target.self");
    if (target.kind === "actor") return combat.combatants.get(target.pid)?.name ?? "?";
    if (target.kind === "entry") {
      const e = combat.encounterState.stack.find((x) => x.id === target.entryId);
      return e ? `↳ ${e.name}: ${e.decl.label}` : "?";
    }
    return "";
  }

  #logLine(s, l) {
    const name = (pid) => s.names[pid] ?? pid;
    const entry = (id) => s.stack.find((e) => e.id === id);
    return game.i18n.format(`MODULUS.Encounter.Log.${l.type}`, {
      round: l.round,
      name: name(l.pid ?? entry(l.entryId)?.pid),
      label: l.label ?? entry(l.entryId)?.decl.label ?? "",
      outcome: l.outcome ?? "",
      drop: l.drop ?? 0,
      n: l.prompted?.length ?? 0
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const combat = this.combat;
    if (!combat) return;
    for (const input of this.element.querySelectorAll("input.em-momentum")) {
      input.addEventListener("change", (ev) => combat.combatants.get(ev.target.dataset.id)?.setMomentum(ev.target.value));
    }
    for (const box of this.element.querySelectorAll("input.em-active")) {
      box.addEventListener("change", (ev) => encounterController(combat).setParticipating(ev.target.dataset.id, ev.target.checked));
    }
    for (const sel of this.element.querySelectorAll("select.em-track")) {
      sel.addEventListener("change", (ev) => combat.combatants.get(ev.target.dataset.id)?.setFlag(SYSTEM_ID, "sceneTrack", ev.target.value));
    }
    // Drop actors (no token needed) to add them, e.g. for relationships.
    const zone = this.element.querySelector(".em-participants");
    zone?.addEventListener("dragover", (ev) => ev.preventDefault());
    zone?.addEventListener("drop", async (ev) => {
      if (!game.user.isGM) return;
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if (data?.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      if (actor) await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, name: actor.name, img: actor.img }]);
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const rerender = foundry.utils.debounce(() => this.rendered && this.render(), 50);
    for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "updateActor"]) {
      this.#hooks.push([hook, Hooks.on(hook, rerender)]);
    }
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  get controller() {
    return encounterController(this.combat);
  }

  /* -------------------------------------------- */

  static #onSelect(event, target) {
    this.selectedId = target.closest("[data-combat-id]").dataset.combatId;
    this.render();
  }

  static async #onCreate() {
    const t = (k) => game.i18n.localize(k);
    const kinds = ENCOUNTER_KINDS.map((k) => `<option value="${k}">${t(`MODULUS.Encounter.Kind.${k}`)}</option>`).join("");
    const parents = game.combats.map((c) => `<option value="${c.id}">${foundry.utils.escapeHTML(c.label)}</option>`).join("");
    const data = await DialogV2.wait({
      window: { title: "MODULUS.Encounter.Create" },
      classes: ["modulus"],
      content: `
        <div class="form-group"><label>${t("Name")}</label><input type="text" name="name" autofocus></div>
        <div class="form-group"><label>${t("MODULUS.Encounter.KindLabel")}</label><select name="kind">${kinds}</select></div>
        <div class="form-group"><label>${t("MODULUS.Encounter.Persistent")}</label><input type="checkbox" name="persistent"></div>
        <div class="form-group"><label>${t("MODULUS.Encounter.Parent")}</label><select name="parentId"><option value=""></option>${parents}</select></div>
        <div class="form-group"><label>${t("MODULUS.Encounter.Scale")}</label><select name="scale"><option value=""></option><option value="macro">macro</option><option value="meso">meso</option><option value="micro">micro</option></select></div>
        <div class="form-group"><label>${t("MODULUS.Encounter.AddSelected")}</label><input type="checkbox" name="addTokens" checked></div>`,
      rejectClose: false,
      buttons: [{ action: "ok", label: "MODULUS.Encounter.Create", default: true, callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object }]
    });
    if (!data) return;
    const combat = await Combat.create({
      name: data.name || "",
      scene: null,
      active: false,
      flags: { [SYSTEM_ID]: { kind: data.kind, persistent: Boolean(data.persistent) || data.kind !== "standard", parentId: data.parentId || null, scale: data.scale || "" } }
    });
    this.selectedId = combat.id;
    if (data.addTokens) await EncounterManager.#addControlled(combat);
    this.render();
  }

  static async #addControlled(combat) {
    const tokens = canvas.tokens?.controlled ?? [];
    const existing = new Set(combat.combatants.map((c) => c.tokenId).filter(Boolean));
    const data = tokens.filter((t) => t.actor && !existing.has(t.id)).map((t) => ({ tokenId: t.id, sceneId: t.scene.id, actorId: t.actor.id }));
    if (data.length) await combat.createEmbeddedDocuments("Combatant", data);
  }

  static async #onAddTokens() {
    if (this.combat) await EncounterManager.#addControlled(this.combat);
  }

  static async #onRemoveCombatant(event, target) {
    await this.combat?.combatants.get(target.closest("[data-id]").dataset.id)?.delete();
  }

  static async #onDeleteEncounter() {
    const combat = this.combat;
    if (!combat) return;
    const ok = await DialogV2.confirm({
      window: { title: "MODULUS.Encounter.End" },
      content: `<p>${game.i18n.format("MODULUS.Encounter.EndConfirm", { name: foundry.utils.escapeHTML(combat.label) })}</p>`
    });
    if (!ok) return;
    await encounterController(combat).endEncounterStatuses();
    await combat.delete();
    this.selectedId = null;
  }

  static #onStartRound() {
    this.controller.startRound();
  }

  static #onResendParticipation() {
    this.controller.asked.clear();
    this.controller.requestParticipation();
  }

  static #onBeginDeclarations() {
    this.controller.beginDeclarations();
  }

  static #onResend() {
    const step = this.controller.currentStep();
    if (step) this.controller.ask(step, { force: true });
  }

  /** Declare, re-confirm or pick a Duelist drop on the participant's behalf (§14 overrides). */
  static async #onActForThem() {
    const ctl = this.controller;
    const step = ctl.currentStep();
    if (!step) return;
    const info = ctl.stepInfo(step);
    const combatant = info.combatant;
    if (!combatant?.actor) return;
    if (step.type === "declare") {
      const charge = this.combat.encounterState.memory[combatant.id]?.charge;
      const continuing = charge?.payload && charge.lastRound === this.combat.encounterState.round - 1;
      const answer = await ActionBuilder.prompt(combatant.actor, {
        mode: "declare", combat: this.combat, combatant,
        prefill: continuing ? charge.payload : null,
        note: continuing ? game.i18n.format("MODULUS.Encounter.ContinueCharging", { label: charge.label, n: charge.count }) : ""
      });
      if (answer) await ctl.submitDeclaration(combatant.id, answer);
    } else if (step.type === "reconfirm") {
      const answer = await ActionBuilder.prompt(combatant.actor, {
        mode: "reconfirm", combat: this.combat, combatant, prefill: info.entry.decl.payload,
        note: game.i18n.format("MODULUS.Encounter.ReconfirmNote", { cause: this.combat.encounterState.names[step.causePid] ?? "" })
      });
      if (answer) await ctl.submitReconfirm(step.entryId, answer);
    } else if (step.type === "duelist") {
      const drop = await DialogV2.prompt({
        window: { title: "MODULUS.Encounter.Duelist" },
        content: `<p>${game.i18n.format("MODULUS.Encounter.DuelistHint", { max: info.entry.decl.duelist })}</p><input type="number" name="drop" value="0" min="0" max="${info.entry.decl.duelist}">`,
        ok: { callback: (e, b) => Number(b.form.elements.drop.value) || 0 },
        rejectClose: false
      });
      if (drop != null) await ctl.submitDuelist(step.entryId, drop);
    }
  }

  static #onPassForThem() {
    const step = this.controller.currentStep();
    if (step?.type === "declare") this.controller.submitDeclaration(step.pid, { type: "pass" });
  }

  static #onForceConfirm() {
    const step = this.controller.currentStep();
    if (step?.type === "reconfirm") this.controller.forceConfirm(step.entryId);
  }

  static #onSkipDuelist() {
    const step = this.controller.currentStep();
    if (step?.type === "duelist") this.controller.submitDuelist(step.entryId, 0);
  }

  static #onResolveNext() {
    this.controller.resolveNext();
  }

  static #onInterrupt(event, target) {
    this.controller.interrupt(target.closest("[data-entry-id]").dataset.entryId);
  }

  static #onSetOut(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    this.controller.setOut(id, target.dataset.out === "true");
  }

  static #onEndRound() {
    this.controller.endRound();
  }

  static #onOpenSheet(event, target) {
    this.combat?.combatants.get(target.closest("[data-id]").dataset.id)?.actor?.sheet.render(true);
  }
}

