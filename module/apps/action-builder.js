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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Plain data the rules engine needs from an action Item. */
export function actionData(item) {
  const s = item.system;
  return { name: item.name, rollStat: s.rollStat, targetStat: s.targetStat, momentumCost: s.momentumCost, tags: s.tags, effects: s.effects, rolls: s.rolls };
}

export function wordData(item) {
  const s = item.system;
  return { name: item.name, momentumModifier: s.momentumModifier, tags: s.tags, effects: s.effects };
}

/** Actions and words this actor can use: owned ones plus world untrained actions and base words (§6.1, §6.2). */
export function availableVocabulary(actor) {
  const owned = actor.items;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const actions = [...owned.filter((i) => i.type === "action"), ...game.items.filter((i) => i.type === "action" && !i.system.trained)];
  const words = [...owned.filter((i) => i.type === "word"), ...game.items.filter((i) => i.type === "word" && i.system.baseWord)];
  const dedupe = (list) => [...new Map(list.map((i) => [i.uuid, i])).values()].sort(byName);
  return { actions: dedupe(actions), words: dedupe(words) };
}

function statusesOf(actor) {
  return actor.items.filter((i) => i.type === "status").map((i) => ({ name: i.name, value: i.system.value, effects: i.system.effects }));
}

/**
 * Assemble a declaration and work out everything resolution needs.
 * @param {Actor} actor
 * @param {{action: Item, words: Item[], target: Actor|null, targetMode: "target"|"self"|"none", sceneTrack?: string}} d
 */
export function buildDeclaration(actor, { action, words, target, targetMode, sceneTrack }) {
  let targetCtx = null;
  if (targetMode === "self") targetCtx = { kind: "self" };
  else if (targetMode === "target" && target) {
    const exposed = statusesOf(target).filter((s) => s.name.toLowerCase() === "exposed").reduce((n, s) => n + (s.value || 0), 0);
    targetCtx = target === actor ? { kind: "self" } : { kind: "other", resistance: target.system.momentum.resistance, exposed };
  }
  const assembled = assembleAction({
    action: actionData(action),
    words: words.map(wordData),
    actor: { momentum: actor.system.momentum.current, maxWords: actor.system.maxWords, sceneTrack },
    target: targetCtx,
    statuses: statusesOf(actor),
    settings: assemblySettings()
  });

  const plan = { assembled, target: targetCtx?.kind === "other" ? target : null, dc: null, dcSource: null, tier: null };
  if (assembled.rolls && assembled.rollStat) {
    const eff = actor.getEffectiveTier(assembled.rollStat, { shifts: assembled.tierShifts.map((s) => s.delta) });
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
      // §6.6 step 7: the DC is looked up at resolution; this is a preview of it.
      const def = plan.target.getDefenseDC(assembled.targetStat);
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

/** Roll a built declaration and post the card. Deducts momentum when `spend` is set (§5.3: at resolution). */
export async function resolveDeclaration(actor, plan, { spend = true } = {}) {
  const a = plan.assembled;
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
    action: {
      tags: formatTags(a.tags),
      cost: a.cost.total,
      rollStat: statLabel(a.rollStat),
      targetStat: statLabel(a.targetStat),
      onHit: describe(a.outcomes.onHit),
      onMiss: describe(a.outcomes.onMiss),
      onResolve: describe(a.outcomes.onResolve),
      flatLines: a.flatLines,
      tierShifts: a.tierShifts
    }
  };
  if (a.rolls) {
    const roll = ModulusRoll.create({ tier: plan.tier, buff: plan.buff, debuff: plan.debuff, flatBonus: a.flatBonus, dc: plan.dc, context });
    await roll.evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  } else {
    const content = await foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/chat/action-card.hbs`, { ctx: context });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  }
  if (spend && a.cost.total) {
    await actor.update({ "system.momentum.current": actor.system.momentum.current - a.cost.total });
  }
}

export class ActionBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "action-builder"],
    window: { icon: "fa-solid fa-hand-fist", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      resolve: ActionBuilder.#onResolve
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/action-builder.hbs` }
  };

  constructor(actor, options = {}) {
    super({ id: `modulus-action-builder-${actor.id}`, ...options });
    this.actor = actor;
    this.state = { action: "", words: [], targetMode: "target", spend: true, sceneTrack: "", override: false };
  }

  get title() {
    return game.i18n.format("MODULUS.Builder.Title", { name: this.actor.name });
  }

  _current() {
    const { actions, words } = availableVocabulary(this.actor);
    const action = actions.find((i) => i.uuid === this.state.action) ?? actions[0] ?? null;
    if (action) this.state.action = action.uuid;
    const chosen = this.state.words.map((u) => words.find((w) => w.uuid === u)).filter(Boolean);
    const target = game.user.targets.first()?.actor ?? null;
    return { actions, words, action, chosen, target };
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    const { actions, words, action, chosen, target } = this._current();
    const maxWords = this.actor.system.maxWords;
    // Slots: one per allowed word, plus one more so going over the limit is visible.
    const slots = Array.from({ length: Math.max(maxWords, chosen.length) + 1 }, (_, i) => ({
      index: i, value: this.state.words[i] ?? "", over: i >= maxWords
    }));
    const ctx = {
      actor: this.actor,
      actionOptions: Object.fromEntries(actions.map((i) => [i.uuid, i.name])),
      wordOptions: Object.fromEntries(words.map((i) => [i.uuid, `${i.name} (${i.system.momentumModifier >= 0 ? "+" : ""}${i.system.momentumModifier})`])),
      slots,
      state: this.state,
      targetName: target?.name,
      targetModes: { target: t("MODULUS.Builder.Target.target"), self: t("MODULUS.Builder.Target.self"), none: t("MODULUS.Builder.Target.none") },
      sceneTracks: { "": "—", physical: t("MODULUS.Domain.physical"), mental: t("MODULUS.Domain.mental"), social: t("MODULUS.Domain.social") },
      isGM: game.user.isGM,
      momentum: this.actor.system.momentum.current,
      noActions: !actions.length
    };
    if (!action) return ctx;
    const plan = buildDeclaration(this.actor, { action, words: chosen, target, targetMode: this.state.targetMode, sceneTrack: this.state.sceneTrack || undefined });
    const a = plan.assembled;
    const lineLabel = (l) => (["extraWords", "focus", "sceneTrack", "exposed", "resistance"].includes(l.label) ? t(`MODULUS.Builder.Line.${l.label}`) : l.label);
    ctx.plan = {
      label: a.label,
      rolls: a.rolls,
      rollStat: statLabel(a.rollStat),
      targetStat: statLabel(a.targetStat),
      tags: a.tags.map((tag) => (tag.value ? `${tag.name} ${tag.value}` : tag.name)),
      costLines: a.cost.lines.map((l) => ({ label: lineLabel(l), value: l.value >= 0 ? `+${l.value}` : `${l.value}` })),
      cost: a.cost.total,
      afterCost: this.actor.system.momentum.current - a.cost.total,
      effectiveMomentum: a.effectiveMomentum,
      slow: a.slow,
      fast: a.fast,
      diceLines: a.dice.lines.map((l) => ({ label: lineLabel(l), buff: l.buff, debuff: l.debuff })),
      tier: plan.tier && t(`MODULUS.Tier.${plan.tier}`),
      buff: plan.buff,
      debuff: plan.debuff,
      extraDebuff: plan.extraDebuff,
      flatBonus: a.flatBonus,
      tierShifts: a.tierShifts,
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
    ctx.canResolve = a.valid || (game.user.isGM && this.state.override);
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const el of this.element.querySelectorAll("[data-state]")) {
      el.addEventListener("change", (ev) => {
        const key = ev.target.dataset.state;
        const value = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
        if (key === "word") {
          const i = Number(ev.target.dataset.index);
          const words = [...this.state.words];
          words[i] = value;
          this.state.words = words.filter(Boolean); // blank slot removes the word
        } else this.state[key] = value;
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
      ["updateItem", Hooks.on("updateItem", rerender)],
      ["createItem", Hooks.on("createItem", rerender)],
      ["deleteItem", Hooks.on("deleteItem", rerender)]
    ];
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
  }

  static async #onResolve() {
    const { action, chosen, target } = this._current();
    if (!action) return;
    const plan = buildDeclaration(this.actor, { action, words: chosen, target, targetMode: this.state.targetMode, sceneTrack: this.state.sceneTrack || undefined });
    if (!plan.assembled.valid && !(game.user.isGM && this.state.override)) return;
    await resolveDeclaration(this.actor, plan, { spend: this.state.spend });
  }
}

export function openActionBuilder(actor) {
  const app = foundry.applications.instances.get(`modulus-action-builder-${actor.id}`) ?? new ActionBuilder(actor);
  app.render({ force: true });
  return app;
}
