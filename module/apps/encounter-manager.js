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
import { describeInstance } from "../encounter/condfx-bridge.js";
import { filterEncounters, parseLabels } from "../rules/extended.js";

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
      openSheet: EncounterManager.#onOpenSheet,
      cancelDelayed: EncounterManager.#onCancelDelayed,
      removeEffect: EncounterManager.#onRemoveEffect,
      closeEncounter: EncounterManager.#onCloseEncounter,
      reopenEncounter: EncounterManager.#onReopenEncounter,
      showInTracker: EncounterManager.#onShowInTracker,
      roomEntry: EncounterManager.#onRoomEntry,
      addSubject: EncounterManager.#onAddSubject,
      clearFilter: EncounterManager.#onClearFilter
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
  /** List filter: kind, label, text, and whether closed extended encounters show. */
  filter = { kind: "", label: "", text: "", closed: false };
  #hooks = [];

  /** Every encounter this user may see. */
  get allEncounters() {
    return game.combats.filter((c) => game.user.isGM || c.combatants.some((x) => x.actor?.isOwner) || c.visible);
  }

  /** The list after the filter. The selected encounter stays listed even when filtered out. */
  get encounters() {
    const all = this.allEncounters;
    const shown = new Set(filterEncounters(all.map((c) => ({ c, name: c.label, kind: c.kind, labels: c.labels, closed: c.closed })), this.filter).map((e) => e.c));
    return all.filter((c) => shown.has(c) || c.id === this.selectedId);
  }

  get combat() {
    const all = this.allEncounters;
    return all.find((c) => c.id === this.selectedId) ?? this.encounters[0] ?? null;
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    const combat = this.combat;
    const isGM = game.user.isGM;
    const all = this.allEncounters;
    const allLabels = [...new Set(all.flatMap((c) => c.labels))].sort((a, b) => a.localeCompare(b));
    const ctx = {
      isGM,
      filter: this.filter,
      filtered: Boolean(this.filter.kind || this.filter.label || this.filter.text || this.filter.closed),
      kindOptions: { "": t("MODULUS.Encounter.Filter.AllKinds"), ...Object.fromEntries(ENCOUNTER_KINDS.map((k) => [k, t(`MODULUS.Encounter.Kind.${k}`)])) },
      labelOptions: allLabels.length ? { "": t("MODULUS.Encounter.Filter.AllLabels"), ...Object.fromEntries(allLabels.map((l) => [l, l])) } : null,
      hiddenCount: all.length - this.encounters.length,
      encounters: this.encounters.map((c) => ({
        id: c.id,
        label: c.label,
        kind: t(`MODULUS.Encounter.Kind.${c.kind}`),
        kindKey: c.kind,
        labels: c.labels,
        round: c.encounterState.round,
        phase: t(`MODULUS.Encounter.Phase.${c.encounterState.phase}`),
        persistent: c.persistent,
        closed: c.closed,
        active: c.active,
        who: c.combatants.map((x) => x.name).join(", "),
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
    const names = { ...Object.fromEntries(combat.combatants.map((c) => [c.id, c.name])), ...s.names };
    const effectsOn = (pid) => (s.condfx?.instances ?? []).filter((i) => i.applyToId === pid).map((i) => describeInstance(i, names));

    const waiting = controller?.waitingOn() ?? (step && step.type !== "done" ? { step, name: s.names[step.pid] ?? s.stack.find((e) => e.id === step.entryId)?.name } : null);
    if (waiting) Object.assign(waiting, { isDeclare: waiting.step.type === "declare", isReconfirm: waiting.step.type === "reconfirm", isDuelist: waiting.step.type === "duelist" });
    ctx.combat = {
      id: combat.id,
      label: combat.label,
      kind: t(`MODULUS.Encounter.Kind.${combat.kind}`),
      persistent: combat.persistent,
      extended: combat.kind !== "standard",
      isStandard: combat.kind === "standard" && !combat.persistent,
      labels: combat.labels,
      labelText: combat.labels.join(", "),
      closed: combat.closed,
      outcomeNote: combat.outcomeNote,
      active: combat.active,
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
          player: c.playerOwners[0]?.name ?? null,
          effects: effectsOn(c.id),
          team: c.team
        };
      }).sort((a, b) => (b.momentum - a.momentum) || a.name.localeCompare(b.name)),
      stack: [...resolutionOrder(s), ...s.stack.filter((e) => e.cancelled)].map((e) => ({
        id: e.id,
        name: e.name,
        label: e.decl.label,
        tags: e.decl.tags,
        state: e.state,
        stateLabel: e.cancelled ? t("MODULUS.Encounter.Interrupted")
          : e.resolved ? t("MODULUS.Encounter.Outcome.resolved")
          : t(`MODULUS.Encounter.State.${e.state}`),
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
      log: s.log.slice(-8).reverse().map((l) => this.#logLine(s, l)),
      delayed: (s.delayed ?? []).map((d) => ({
        id: d.id, source: d.source, text: d.text, dueRound: d.dueRound,
        inRounds: d.dueRound - s.round,
        target: names[d.targetPid] ?? (d.effect.to === "self" ? names[d.actorPid] : null)
      })).sort((a, b) => a.dueRound - b.dueRound)
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
    // List filter (kept on this window while it is open).
    for (const el of this.element.querySelectorAll("[data-filter]")) {
      // "change": text search applies on Enter or leaving the box, so typing keeps focus.
      el.addEventListener("change", (ev) => {
        const key = ev.target.dataset.filter;
        this.filter[key] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
        this.render();
      });
    }
    const combat = this.combat;
    if (!combat) return;
    for (const input of this.element.querySelectorAll("input.em-momentum")) {
      input.addEventListener("change", (ev) => combat.combatants.get(ev.target.dataset.id)?.setMomentum(ev.target.value));
    }
    for (const box of this.element.querySelectorAll("input.em-active")) {
      box.addEventListener("change", (ev) => encounterController(combat).setParticipating(ev.target.dataset.id, ev.target.checked));
    }
    for (const input of this.element.querySelectorAll("input.em-team")) {
      input.addEventListener("change", (ev) => combat.combatants.get(ev.target.dataset.id)?.setFlag(SYSTEM_ID, "team", ev.target.value.trim()));
    }
    for (const sel of this.element.querySelectorAll("select.em-track")) {
      sel.addEventListener("change", (ev) => combat.combatants.get(ev.target.dataset.id)?.setFlag(SYSTEM_ID, "sceneTrack", ev.target.value));
    }
    this.element.querySelector("input.em-labels")?.addEventListener("change", (ev) => combat.setFlag(SYSTEM_ID, "labels", parseLabels(ev.target.value)));
    // Drop actors (no token needed) to add them, e.g. for relationships.
    const zone = this.element.querySelector(".em-participants");
    zone?.addEventListener("dragover", (ev) => ev.preventDefault());
    zone?.addEventListener("drop", async (ev) => {
      if (!game.user.isGM) return;
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if (data?.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      if (actor && !actor.isToken) await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, name: actor.name, img: actor.img }]);
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
        <div class="form-group"><label>${t("MODULUS.Encounter.Labels")}</label><input type="text" name="labels" placeholder="${t("MODULUS.Encounter.LabelsHint")}"></div>
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
      flags: { [SYSTEM_ID]: { kind: data.kind, persistent: Boolean(data.persistent) || data.kind !== "standard", parentId: data.parentId || null, scale: data.scale || "", labels: parseLabels(data.labels) } }
    });
    this.selectedId = combat.id;
    if (data.addTokens) await EncounterManager.#addControlled(combat);
    this.render();
  }

  /**
   * Add the selected tokens. A persistent encounter outlives scenes and tokens, so its
   * participants are the world actors, not the tokens; an unlinked token's own changes are not
   * carried (the GM is told).
   */
  static async #addControlled(combat) {
    const tokens = (canvas.tokens?.controlled ?? []).filter((t) => t.actor);
    let data;
    if (combat.persistent) {
      const existing = new Set(combat.combatants.map((c) => c.actorId));
      const unlinked = tokens.filter((t) => !t.document.actorLink).map((t) => t.name);
      if (unlinked.length) ui.notifications.warn(game.i18n.format("MODULUS.Encounter.UnlinkedToken", { names: unlinked.join(", ") }));
      const actors = [...new Map(tokens.map((t) => [t.document.actorId, game.actors.get(t.document.actorId)])).values()].filter((a) => a && !existing.has(a.id));
      data = actors.map((a) => ({ actorId: a.id, name: a.name, img: a.img }));
    } else {
      const existing = new Set(combat.combatants.map((c) => c.tokenId).filter(Boolean));
      data = tokens.filter((t) => !existing.has(t.id)).map((t) => ({ tokenId: t.id, sceneId: t.scene.id, actorId: t.actor.id }));
    }
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

  static #onCancelDelayed(event, target) {
    this.controller.cancelDelayed(target.closest("[data-delayed-id]").dataset.delayedId);
  }

  static #onRemoveEffect(event, target) {
    this.controller.removeEffect(target.dataset.fxId);
  }

  /** Close an extended encounter (§7.11): it keeps its momentum and history, with an outcome note. */
  static async #onCloseEncounter() {
    const combat = this.combat;
    if (!combat) return;
    const note = await DialogV2.prompt({
      window: { title: "MODULUS.Encounter.Close" },
      classes: ["modulus"],
      content: `<p>${game.i18n.format("MODULUS.Encounter.CloseHint", { name: foundry.utils.escapeHTML(combat.label) })}</p>
        <textarea name="outcome" rows="4">${foundry.utils.escapeHTML(combat.outcomeNote)}</textarea>`,
      ok: { label: "MODULUS.Encounter.Close", callback: (e, b) => b.form.elements.outcome.value.trim() },
      rejectClose: false
    });
    if (note == null) return;
    await combat.update({ [`flags.${SYSTEM_ID}.closed`]: true, [`flags.${SYSTEM_ID}.outcome`]: note, active: false });
  }

  static async #onReopenEncounter() {
    await this.combat?.setFlag(SYSTEM_ID, "closed", false);
  }

  /** Show this encounter in Foundry's combat tracker (the tracker shows one at a time). */
  static async #onShowInTracker() {
    await this.combat?.activate();
  }

  /** Room entry (§7.11): set each participant's momentum from their relationships with those present. */
  static async #onRoomEntry() {
    const combat = this.combat;
    if (!combat) return;
    const lines = [];
    for (const c of combat.combatants) {
      const { value, from } = c.entryMomentum();
      if (value !== c.momentum) await c.setMomentum(value);
      lines.push(`${foundry.utils.escapeHTML(c.name)}: ${value}${from ? ` (${foundry.utils.escapeHTML(game.combats.get(from)?.label ?? "")})` : ""}`);
    }
    if (lines.length) await encounterController(combat).chat(`${game.i18n.localize("MODULUS.Encounter.RoomEntryDone")}<br>${lines.join("<br>")}`);
  }

  /** A subject (§7.11): a GM-controlled participant such as the mystery or the wilderness, momentum only. */
  static async #onAddSubject() {
    const combat = this.combat;
    if (!combat) return;
    const name = await DialogV2.prompt({
      window: { title: "MODULUS.Encounter.AddSubject" },
      classes: ["modulus"],
      content: `<p class="hint">${game.i18n.localize("MODULUS.Encounter.AddSubjectHint")}</p><input type="text" name="name" value="${foundry.utils.escapeHTML(combat.label)}" autofocus>`,
      ok: { callback: (e, b) => b.form.elements.name.value.trim() },
      rejectClose: false
    });
    if (!name) return;
    const actor = await Actor.create({ name, type: "subject", img: "icons/svg/mystery-man.svg" });
    if (actor) await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id, name: actor.name, img: actor.img }]);
  }

  static #onClearFilter() {
    this.filter = { kind: "", label: "", text: "", closed: false };
    this.render();
  }

  static #onOpenSheet(event, target) {
    this.combat?.combatants.get(target.closest("[data-id]").dataset.id)?.actor?.sheet.render(true);
  }
}

