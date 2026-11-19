/**
 * Action Builder: assemble a core action + words (§6.6), preview cost, dice, DC and
 * chance live, then roll it. This is the Phase 2 testbed for the assembly engine and
 * the cost preview; the Phase 3 Declare dialog reuses `buildDeclaration`.
 */
import { SYSTEM_ID } from "../config.js";
import { assembleAction } from "../rules/assembly.js";
import { describeEffect } from "../rules/effects.js";
import { formatTags } from "../rules/tags.js";
import { hitChance } from "../rules/dice.js";
import { dcForTier } from "../rules/tier.js";
import { assemblySettings, dcTable, getSetting } from "../settings.js";
import { ModulusRoll } from "../documents/roll.js";
import { statLabel } from "./item-sheet.js";
import { rollModifiers } from "../encounter/condfx-bridge.js";
import { talentGrants, isGranted, knowsWord } from "../rules/talents.js";
import { catalogItems } from "../vocab/catalog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Display text for a flat roll line (unknown words, Duelist, Exposed, gated bonuses). */
export function flatLineText(l) {
  const signed = `${l.value >= 0 ? "+" : "−"}${Math.abs(l.value)}`;
  const label = l.kind === "unknownWord" ? game.i18n.format("MODULUS.Builder.UnknownWord", { name: l.label })
    : ["duelist", "exposed"].includes(l.label) ? game.i18n.localize(`MODULUS.Builder.Line.${l.label}`) : l.label;
  return { label, value: signed, penalty: l.value < 0 };
}

/** Plain data the rules engine needs from an action Item. */
export function actionData(item) {
  const s = item.system;
  return { name: item.name, rollStat: s.rollStat, targetStat: s.targetStat, momentumCost: s.momentumCost, tags: s.tags, effects: s.effects, rolls: s.rolls };
}

export function wordData(item, known = true) {
  const s = item.system;
  return { name: item.name, momentumModifier: s.momentumModifier, tags: s.tags, effects: s.effects, penalty: s.penalty ?? 0, tierDowngrade: s.tierDowngrade ?? 0, known };
}

/** Which words this actor knows (§6.2): on the sheet, granted by a talent, or a base word. */
export function wordKnowledge(actor) {
  const owned = new Set();
  for (const i of actor.items.filter((x) => x.type === "word")) {
    owned.add(i.name.toLowerCase());
    const v = i.getFlag?.("modulus", "vocabId");
    if (v) owned.add(String(v).toLowerCase());
  }
  const granted = talentGrants(actor.items.filter((i) => i.type === "talent").map((i) => i.system)).words;
  return (item) => knowsWord({ name: item.name, vocabId: item.getFlag?.("modulus", "vocabId"), baseWord: item.system.baseWord }, { owned, granted });
}

/**
 * Actions and words this actor can use (§6.1, §6.2, §3.6). Actions: owned ones, untrained ones, and
 * those granted by the actor's talents. Words: every word (anyone may use any word); the ones the
 * actor doesn't know carry their penalty (see wordKnowledge). The world's Items plus the system's
 * compendium entries (vocab/catalog.js).
 */
export function availableVocabulary(actor) {
  const owned = actor.items;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const grants = talentGrants(owned.filter((i) => i.type === "talent").map((i) => i.system));
  const entry = (i) => ({ name: i.name, vocabId: i.getFlag?.("modulus", "vocabId") });
  const actions = [...owned.filter((i) => i.type === "action"),
    ...catalogItems("action").filter((i) => !i.system.trained || isGranted(entry(i), grants.actions))];
  const words = [...owned.filter((i) => i.type === "word"), ...catalogItems("word")];
  const dedupe = (list) => [...new Map(list.map((i) => [i.uuid, i])).values()].sort(byName);
  // One entry per word name: the character's own copy wins over the catalog's.
  const byWordName = new Map();
  for (const w of words) if (!byWordName.has(w.name.toLowerCase()) || w.parent === actor) byWordName.set(w.name.toLowerCase(), w);
  return { actions: dedupe(actions), words: [...byWordName.values()].sort(byName) };
}

function statusesOf(actor) {
  return actor.items.filter((i) => i.type === "status").map((i) => ({ name: i.name, value: i.system.value, effects: i.system.effects }));
}

/**
 * Assemble a declaration and work out everything resolution needs.
 * @param {Actor} actor
 * @param {object} d
 * @param {Item} d.action
 * @param {Item[]} d.words
 * @param {Actor|null} d.target          target actor, when targetMode is "target"
 * @param {"target"|"self"|"none"|"entry"} d.targetMode
 * @param {string} [d.sceneTrack]
 * @param {number} [d.momentum]          momentum to check against (encounter momentum); default the sheet value
 * @param {{buff?: number, debuff?: number}} [d.extraDice]  e.g. aid / hinder from the stack
 * @param {number} [d.extraFlat]         e.g. Duelist bonus
 */
export function buildDeclaration(actor, { action, words, target, targetMode, sceneTrack, momentum, extraDice = {}, extraFlat = 0, condFx = null }) {
  let targetCtx = null;
  if (targetMode === "self") targetCtx = { kind: "self" };
  else if (targetMode === "entry") targetCtx = { kind: "entry" };
  else if (targetMode === "target" && target) {
    const exposed = statusesOf(target).filter((s) => s.name.toLowerCase() === "exposed").reduce((n, s) => n + (s.value || 0), 0);
    targetCtx = target === actor ? { kind: "self" } : { kind: "other", resistance: target.system.momentum.resistance, exposed };
  }
  const knows = wordKnowledge(actor);
  const assembled = assembleAction({
    action: actionData(action),
    words: words.map((w) => wordData(w, knows(w))),
    actor: { momentum: momentum ?? actor.system.momentum.current, maxWords: actor.system.maxWords, sceneTrack },
    target: targetCtx,
    statuses: statusesOf(actor),
    settings: assemblySettings()
  });
  if (extraDice.buff) assembled.dice.lines.push({ label: "aid", buff: extraDice.buff, debuff: 0 });
  if (extraDice.debuff) assembled.dice.lines.push({ label: "hinder", buff: 0, debuff: extraDice.debuff });
  assembled.dice.buff += extraDice.buff ?? 0;
  assembled.dice.debuff += extraDice.debuff ?? 0;
  if (extraFlat) {
    assembled.flatLines.push({ label: "duelist", value: extraFlat });
    assembled.flatBonus += extraFlat;
  }

  // Conditional effects (§8.1) active in this encounter: the roller's own, and the defender's for the DC.
  const own = condFx?.attack?.(assembled.rollStat) ?? { shifts: [], buff: 0, debuff: 0, sources: [] };
  if (own.buff || own.debuff) {
    assembled.dice.lines.push({ label: "talents", buff: own.buff, debuff: own.debuff });
    assembled.dice.buff += own.buff;
    assembled.dice.debuff += own.debuff;
  }
  const plan = { assembled, target: targetCtx?.kind === "other" ? target : null, dc: null, dcSource: null, tier: null, condFxSources: [...own.sources] };
  if (assembled.rolls && assembled.rollStat) {
    const eff = actor.getEffectiveTier(assembled.rollStat, { shifts: [...assembled.tierShifts.map((s) => s.delta), ...own.shifts] });
    Object.assign(plan, {
      tier: eff.tier,
      baseTier: eff.baseTier,
      defeatedTracks: eff.defeatedTracks,
      buff: assembled.dice.buff + eff.extraBuffDice,
      debuff: assembled.dice.debuff + eff.extraDebuffDice,
      extraDebuff: eff.extraDebuffDice
    });
    if (assembled.fixedDC != null) {
      plan.dc = assembled.fixedDC;
      plan.dcSource = { kind: "fixed" };
    } else if (assembled.useTaskDC) {
      plan.dc = getSetting("defaultTaskDC");
      plan.dcSource = { kind: "task" };
    } else if (plan.target && assembled.targetStat) {
      // §6.6 step 7: the DC is looked up at resolution; before that this is a preview.
      const defense = condFx?.defense?.(assembled.targetStat) ?? { shifts: [], sources: [] };
      plan.condFxSources.push(...defense.sources);
      plan.condFxDefenseIds = defense.sources.map((i) => i.id);
      const def = plan.target.getDefenseDC(assembled.targetStat, { shifts: defense.shifts });
      plan.dc = dcForTier(def.tier, dcTable());
      plan.dcSource = {
        kind: "target", targetName: plan.target.name, stat: assembled.targetStat,
        statLabel: statLabel(assembled.targetStat), tier: def.tier, defeatedTracks: def.defeatedTracks
      };
    }
    plan.chance = plan.dc == null ? null : hitChance({ tier: plan.tier, buff: plan.buff, debuff: plan.debuff, dc: plan.dc, flatBonus: assembled.flatBonus });
  }
  return plan;
}

/** Summarise an assembled action for the stack engine (rules/encounter.js). */
export function toStackDeclaration(plan, { payload, target }) {
  const a = plan.assembled;
  const v = (name) => a.tags.filter((t) => t.name === name).reduce((n, t) => n + (t.value || 0), 0);
  const has = (name) => a.tags.some((t) => t.name === name);
  return {
    label: a.label,
    actionKey: [payload.actionUuid, ...(payload.wordUuids ?? [])].join("|"),
    cost: a.cost.total,
    slow: a.slow,
    fast: a.fast,
    charge: v("charge"),
    taxing: v("taxing"),
    determined: v("determined"),
    duelist: v("duelist"),
    aid: has("aid") ? v("aid") || 1 : 0,
    hinder: has("hinder") ? v("hinder") || 1 : 0,
    inevitable: has("inevitable"),
    delayed: has("delayed"),
    reaction: has("reaction"),
    recovery: has("recovery"),
    rolls: a.rolls,
    tags: formatTags(a.tags),
    tagList: a.tags,
    words: (a.label.split(" + ").slice(1)),
    rollStat: a.rollStat,
    targetStat: a.targetStat,
    target,
    payload
  };
}

/** Roll a built declaration and post the card. Deducts momentum when `spend` is set (§5.3: at resolution). */
export async function resolveDeclaration(actor, plan, { spend = true, encounter = null } = {}) {
  const a = plan.assembled;
  const outcomeEffects = ["onHit", "onMiss", "onResolve"].flatMap((trigger) => a.outcomes[trigger].map((e) => {
    const { source, ...effect } = e;
    return { trigger, source, effect, text: `${source}: ${describeEffect(e, { stat: statLabel })}` };
  }));
  const describe = (list) => list.map((e) => `${e.source}: ${describeEffect(e, { stat: statLabel })}`);
  const context = {
    label: a.label,
    actorName: actor.name,
    statKey: a.rollStat,
    statLabel: statLabel(a.rollStat),
    baseTier: plan.baseTier,
    tier: plan.tier,
    defeatedTracks: plan.defeatedTracks,
    extraDebuff: plan.extraDebuff,
    dcSource: plan.dcSource,
    encounter,
    targetUuid: plan.target?.uuid ?? null,
    outcomeEffects,
    talentEffects: (plan.condFxSources ?? []).map((i) => ({
      label: i.label || i.talentName,
      talent: i.talentName,
      event: game.i18n.localize(`MODULUS.Talent.Trigger.${i.eventType}`),
      shifts: i.tierShifts.map((s) => `${s.delta * i.stacks > 0 ? "+" : ""}${s.delta * i.stacks} ${s.stat === "*" ? game.i18n.localize("MODULUS.Talent.AllStats") : s.stat.includes("*") ? s.stat : statLabel(s.stat)}`).join(", "),
      dice: i.dice.map((d) => [d.buff ? `+${d.buff * i.stacks}▲` : "", d.debuff ? `+${d.debuff * i.stacks}▼` : ""].join(" ").trim()).filter(Boolean).join(", "),
      defense: (plan.condFxDefenseIds ?? []).includes(i.id)
    })),
    action: {
      tags: formatTags(a.tags),
      cost: a.cost.total,
      rollStat: statLabel(a.rollStat),
      targetStat: statLabel(a.targetStat),
      onHit: describe(a.outcomes.onHit),
      onMiss: describe(a.outcomes.onMiss),
      onResolve: describe(a.outcomes.onResolve),
      flatLines: a.flatLines.map(flatLineText),
      unknownWords: a.unknownWords.filter((w) => w.tierDowngrade).map((w) => game.i18n.format("MODULUS.Builder.UnknownWordTier", { name: w.name, n: w.tierDowngrade })),
      tierShifts: a.tierShifts
    }
  };
  let hit = null;
  let message;
  if (a.rolls) {
    const roll = ModulusRoll.create({ tier: plan.tier, buff: plan.buff, debuff: plan.debuff, flatBonus: a.flatBonus, dc: plan.dc, context });
    await roll.evaluate();
    message = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
    hit = roll.modulus.hit;
  } else {
    const content = await foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/chat/action-card.hbs`, { ctx: context });
    message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, flags: { [SYSTEM_ID]: { context } } });
  }
  if (spend && a.cost.total && !encounter) {
    await actor.update({ "system.momentum.current": actor.system.momentum.current - a.cost.total });
  }
  return { hit, message };
}

/**
 * Action Builder window. Three modes:
 *   standalone  the "Act" button: build, preview, resolve immediately (Phase 2 testbed)
 *   declare     an encounter declaration: Declare or Pass; resolves the `result` promise
 *   reconfirm   a Slow cascade re-confirmation: Keep, or change to the new build
 */
export class ActionBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "action-builder"],
    window: { icon: "fa-solid fa-hand-fist", resizable: true },
    position: { width: 580, height: "auto" },
    actions: {
      resolve: ActionBuilder.#onResolve,
      submit: ActionBuilder.#onSubmit,
      pass: ActionBuilder.#onPass,
      keep: ActionBuilder.#onKeep
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/action-builder.hbs` }
  };

  /**
   * @param {Actor} actor
   * @param {object} [opts]
   * @param {"standalone"|"declare"|"reconfirm"} [opts.mode]
   * @param {Combat} [opts.combat]
   * @param {Combatant} [opts.combatant]
   * @param {{actionUuid, wordUuids, target}} [opts.prefill]
   * @param {string} [opts.note]   shown at the top (e.g. who caused a re-confirmation)
   */
  constructor(actor, { mode = "standalone", combat = null, combatant = null, prefill = null, note = "", ...options } = {}) {
    const id = mode === "standalone" ? `modulus-action-builder-${actor.id}` : `modulus-declare-${combatant?.id ?? actor.id}-${foundry.utils.randomID(4)}`;
    super({ id, ...options });
    this.actor = actor;
    this.mode = mode;
    this.combat = combat;
    this.combatant = combatant;
    this.note = note;
    this.choice = {
      action: prefill?.actionUuid ?? "",
      words: [...(prefill?.wordUuids ?? [])],
      target: prefill?.target ? ActionBuilder.targetKey(prefill.target) : (mode === "standalone" ? "token" : "none"),
      spend: true,
      sceneTrack: combatant?.sceneTrack ?? "",
      override: false
    };
    this.result = new Promise((resolve) => (this._resolveResult = resolve));
  }

  /** Open a declare / reconfirm window and wait for the answer. */
  static prompt(actor, opts) {
    const app = new this(actor, opts);
    app.render({ force: true });
    return app.result;
  }

  static targetKey(target) {
    if (!target || target.kind === "none") return "none";
    if (target.kind === "self") return "self";
    if (target.kind === "actor") return `c:${target.pid}`;
    if (target.kind === "entry") return `e:${target.entryId}`;
    return "none";
  }

  get inEncounter() {
    return this.mode !== "standalone";
  }

  get title() {
    const key = { standalone: "MODULUS.Builder.Title", declare: "MODULUS.Builder.DeclareTitle", reconfirm: "MODULUS.Builder.ReconfirmTitle" }[this.mode];
    return game.i18n.format(key, { name: this.combatant?.name ?? this.actor.name });
  }

  get momentum() {
    return this.inEncounter ? this.combatant.momentum : this.actor.system.momentum.current;
  }

  /** Target choices for the select. */
  _targetOptions() {
    const t = (k) => game.i18n.localize(k);
    const opts = { none: t("MODULUS.Builder.Target.none"), self: t("MODULUS.Builder.Target.self") };
    if (!this.inEncounter) {
      opts.token = t("MODULUS.Builder.Target.target");
      return opts;
    }
    for (const c of this.combat.combatants) {
      if (c.id === this.combatant.id) continue;
      opts[`c:${c.id}`] = c.name;
    }
    const state = this.combat.encounterState;
    for (const e of state.stack) {
      if (e.pid === this.combatant.id || e.cancelled) continue;
      opts[`e:${e.id}`] = game.i18n.format("MODULUS.Builder.Target.entry", { name: e.name, label: e.decl.label });
    }
    return opts;
  }

  /** Resolve the target select into what the rules need. */
  _target() {
    const key = this.choice.target;
    if (key === "self") return { mode: "self", actor: null, stack: { kind: "self" } };
    if (key === "token") {
      const actor = game.user.targets.first()?.actor ?? null;
      return { mode: actor ? "target" : "none", actor, stack: { kind: "none" } };
    }
    if (key.startsWith("c:")) {
      const c = this.combat?.combatants.get(key.slice(2));
      return c ? { mode: "target", actor: c.actor, stack: { kind: "actor", pid: c.id } } : { mode: "none", actor: null, stack: { kind: "none" } };
    }
    if (key.startsWith("e:")) return { mode: "entry", actor: null, stack: { kind: "entry", entryId: key.slice(2) } };
    return { mode: "none", actor: null, stack: { kind: "none" } };
  }

  _current() {
    const { actions, words } = availableVocabulary(this.actor);
    const action = actions.find((i) => i.uuid === this.choice.action) ?? actions[0] ?? null;
    if (action) this.choice.action = action.uuid;
    const chosen = this.choice.words.map((u) => words.find((w) => w.uuid === u)).filter(Boolean);
    return { actions, words, action, chosen, target: this._target() };
  }

  _plan() {
    const { action, chosen, target } = this._current();
    if (!action) return null;
    // In an encounter, preview the talent effects active right now (they are looked up again at resolution).
    const targetPid = target.stack?.kind === "actor" ? target.stack.pid : null;
    const condFx = this.inEncounter ? rollModifiers(this.combat.encounterState, this.combatant.id, targetPid) : null;
    return buildDeclaration(this.actor, {
      action, words: chosen, target: target.actor, targetMode: target.mode,
      sceneTrack: this.choice.sceneTrack || undefined, momentum: this.momentum, condFx
    });
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    const { actions, words, action, chosen, target } = this._current();
    const maxWords = this.actor.system.maxWords;
    const knows = wordKnowledge(this.actor);
    const slots = Array.from({ length: Math.max(maxWords, chosen.length) + 1 }, (_, i) => ({
      index: i, value: this.choice.words[i] ?? "", over: i >= maxWords
    }));
    const ctx = {
      actor: this.actor,
      mode: this.mode,
      isStandalone: this.mode === "standalone",
      isDeclare: this.mode === "declare",
      isReconfirm: this.mode === "reconfirm",
      note: this.note,
      actionOptions: Object.fromEntries(actions.map((i) => [i.uuid, i.name])),
      wordOptions: Object.fromEntries(words.map((i) => {
        const cost = `${i.system.momentumModifier >= 0 ? "+" : ""}${i.system.momentumModifier}`;
        const costs = [
          i.system.penalty ? game.i18n.format("MODULUS.Builder.UnknownPenalty", { n: Math.abs(i.system.penalty) }) : null,
          i.system.tierDowngrade ? game.i18n.format("MODULUS.Builder.UnknownTier", { n: i.system.tierDowngrade }) : null
        ].filter(Boolean);
        const unknown = !knows(i) && costs.length ? ` · ${game.i18n.localize("MODULUS.Builder.NotKnown")} ${costs.join(", ")}` : "";
        return [i.uuid, `${i.name} (${cost})${unknown}`];
      })),
      slots,
      state: this.choice,
      targetOptions: this._targetOptions(),
      targetHint: this.choice.target === "token" ? (target.actor?.name ?? t("MODULUS.Builder.NoTarget")) : "",
      sceneTracks: { "": "—", physical: t("MODULUS.Domain.physical"), mental: t("MODULUS.Domain.mental"), social: t("MODULUS.Domain.social") },
      isGM: game.user.isGM,
      momentum: this.momentum,
      maxWords,
      noActions: !actions.length
    };
    if (!action) return ctx;
    const plan = this._plan();
    const a = plan.assembled;
    const LINES = ["extraWords", "focus", "sceneTrack", "exposed", "resistance", "aid", "hinder", "duelist", "talents"];
    const lineLabel = (l) => (LINES.includes(l.label) ? t(`MODULUS.Builder.Line.${l.label}`) : l.label);
    ctx.plan = {
      label: a.label,
      rolls: a.rolls,
      rollStat: statLabel(a.rollStat),
      targetStat: statLabel(a.targetStat),
      tags: a.tags.map((tag) => (tag.value ? `${tag.name} ${tag.value}` : tag.name)),
      costLines: a.cost.lines.map((l) => ({ label: lineLabel(l), value: l.value >= 0 ? `+${l.value}` : `${l.value}` })),
      cost: a.cost.total,
      afterCost: this.momentum - a.cost.total,
      effectiveMomentum: a.effectiveMomentum,
      slow: a.slow,
      fast: a.fast,
      diceLines: a.dice.lines.map((l) => ({ label: lineLabel(l), buff: l.buff, debuff: l.debuff })),
      tier: plan.tier && t(`MODULUS.Tier.${plan.tier}`),
      buff: plan.buff,
      debuff: plan.debuff,
      extraDebuff: plan.extraDebuff,
      flatBonus: a.flatBonus,
      flatLines: a.flatLines.map(flatLineText),
      unknownWords: a.unknownWords.filter((w) => w.tierDowngrade).map((w) => game.i18n.format("MODULUS.Builder.UnknownWordTier", { name: w.name, n: w.tierDowngrade })),
      tierShifts: a.tierShifts.map((t) => ({ ...t, label: t.kind === "unknownWord" ? game.i18n.format("MODULUS.Builder.UnknownWord", { name: t.label }) : t.label })),
      dc: plan.dc,
      dcSource: plan.dcSource,
      chance: plan.chance == null ? null : `${(plan.chance * 100).toFixed(1)}%`,
      outcomes: ["onHit", "onMiss", "onResolve", "declare"].map((k) => ({
        key: k,
        label: t(`MODULUS.Effect.Trigger.${k}`),
        lines: (k === "declare" ? a.declareEffects : a.outcomes[k]).map((e) => `${e.source}: ${describeEffect(e, { stat: statLabel })}`)
      })).filter((o) => o.lines.length),
      errors: a.errors.map((e) => game.i18n.format(`MODULUS.Builder.Error.${e.code}`, e)),
      warnings: a.warnings.map((w) => game.i18n.format(`MODULUS.Builder.Warning.${w.code}`, w)),
      valid: a.valid
    };
    ctx.canResolve = a.valid || (game.user.isGM && this.choice.override);
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const el of this.element.querySelectorAll("[data-state]")) {
      el.addEventListener("change", (ev) => {
        const key = ev.target.dataset.state;
        const value = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
        if (key === "word") {
          const words = [...this.choice.words];
          words[Number(ev.target.dataset.index)] = value;
          this.choice.words = words.filter(Boolean); // a blank slot removes the word
        } else this.choice[key] = value;
        this.render();
      });
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const rerender = () => this.rendered && this.render();
    this._hooks = [
      ["targetToken", Hooks.on("targetToken", rerender)],
      ["updateActor", Hooks.on("updateActor", (doc) => doc === this.actor && rerender())],
      ["updateCombat", Hooks.on("updateCombat", (doc) => doc === this.combat && rerender())],
      ["updateCombatant", Hooks.on("updateCombatant", (doc) => doc === this.combatant && rerender())],
      ["updateItem", Hooks.on("updateItem", rerender)],
      ["createItem", Hooks.on("createItem", rerender)],
      ["deleteItem", Hooks.on("deleteItem", rerender)],
      ["modulus.catalogReady", Hooks.on("modulus.catalogReady", rerender)]
    ];
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
    this._resolveResult?.(null); // closed without answering
  }

  /** The payload sent to the GM: uuids and target, never derived numbers. */
  _payload() {
    const { action, chosen, target } = this._current();
    return {
      actionUuid: action.uuid,
      wordUuids: chosen.map((w) => w.uuid),
      target: target.stack,
      sceneTrack: this.choice.sceneTrack || ""
    };
  }

  _finish(result) {
    const resolve = this._resolveResult;
    this._resolveResult = null;
    resolve?.(result);
    this.close();
  }

  static async #onResolve() {
    const { action, chosen, target } = this._current();
    if (!action) return;
    const plan = buildDeclaration(this.actor, {
      action, words: chosen, target: target.actor, targetMode: target.mode, sceneTrack: this.choice.sceneTrack || undefined
    });
    if (!plan.assembled.valid && !(game.user.isGM && this.choice.override)) return;
    await resolveDeclaration(this.actor, plan, { spend: this.choice.spend });
  }

  static #onSubmit() {
    const plan = this._plan();
    if (!plan || (!plan.assembled.valid && !(game.user.isGM && this.choice.override))) return;
    this._finish({ type: "declare", payload: this._payload() });
  }

  static #onPass() {
    this._finish({ type: "pass" });
  }

  static #onKeep() {
    this._finish({ type: "keep" });
  }
}

export function openActionBuilder(actor) {
  const app = foundry.applications.instances.get(`modulus-action-builder-${actor.id}`) ?? new ActionBuilder(actor);
  app.render({ force: true });
  return app;
}
