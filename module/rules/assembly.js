/**
 * Assembling a declared action (§6.6) and its momentum cost (§5.3). Pure JS, no Foundry imports.
 *
 *   assembleAction({ action, words, actor, target, statuses, settings })
 *
 * action   { name, rollStat, targetStat, momentumCost, tags, effects, rolls }
 * words    [{ name, momentumModifier, tags, effects, penalty, tierDowngrade, known }]   in declared order;
 *          a word the actor doesn't know (known === false) takes its penalty off the roll and/or
 *          drops the rolling stat by its tier downgrade (§6.2)
 * actor    { momentum, maxWords, sceneTrack? }            sceneTrack: "physical" | "mental" | "social"
 * target   null | { kind: "self" | "other" | "entry", resistance?: {physical, mental, social}, exposed?: number }
 * statuses [{ name, effects }]                            the actor's active statuses ("while" effects apply)
 * settings see DEFAULT_ASSEMBLY_SETTINGS
 *
 * The DC is NOT computed here: it is looked up at resolution (§6.6 step 7).
 */
import { mergeTags, hasTag, tagValue } from "./tags.js";
import { parseStatKey, isStatKey } from "./constants.js";

export const DEFAULT_ASSEMBLY_SETTINGS = Object.freeze({
  sameNameTagStacking: "sum",     // [OPEN #8]
  statOverrideConflict: "last",   // [OPEN #8]
  costFloorZero: true,            // [OPEN #10]
  resistanceTrack: "targetStat",  // [OPEN #11] or "actionDomain" (domain of the roll stat)
  freeWords: 2,                   // words before the extra-word penalty
  extraWordPenalty: 1,            // [OPEN #5] debuff dice per word beyond freeWords
  focusBonus: false,              // [OPEN #6] hook, off by default
  focusBonusDice: 1,              // placeholder magnitude when the hook is on
  sceneTrackBonusDice: 1,         // [DRAFT] buff dice for on-track rolls (§7.10)
  exposedMode: "flat",            // [OPEN #19] "flat" | "dice"
  diceCap: 0                      // [DRAFT] 0 = no cap
});

const PRE_ROLL = new Set(["declare", "finalize", "while"]);

function sourced(list, source) {
  return (list ?? []).filter((e) => e && typeof e === "object").map((effect) => ({ ...effect, source }));
}

/**
 * @returns {object} assembled action:
 *   { name, label, rollStat, targetStat, rolls, tags, cost: {total, lines}, slow, fast, effectiveMomentum,
 *     dice: {buff, debuff, lines}, flatBonus, flatLines, tierShifts, fixedDC, useTaskDC,
 *     outcomes: {onHit, onMiss, onResolve}, declareEffects, errors, warnings, wordCount }
 */
export function assembleAction({ action, words = [], actor = {}, target = null, statuses = [], settings = {} }) {
  const S = { ...DEFAULT_ASSEMBLY_SETTINGS, ...settings };
  const errors = [];
  const warnings = [];

  // Every effect in play, with where it came from.
  const all = [
    ...sourced(action.effects, action.name),
    ...words.flatMap((w) => sourced(w.effects, w.name))
  ];
  const statusEffects = statuses.flatMap((s) => sourced(s.effects, s.name)).filter((e) => e.trigger === "while");
  const pre = [...all.filter((e) => PRE_ROLL.has(e.trigger)), ...statusEffects];

  // 1-2. Stats, then overrides in declared order.
  let rollStat = action.rollStat || "";
  let targetStat = action.targetStat || "";
  const overrides = (op) => pre.filter((e) => e.op === op && isStatKey(e.args?.stat));
  for (const [op, set] of [["rollStat", (v) => (rollStat = v)], ["targetStat", (v) => (targetStat = v)]]) {
    const list = overrides(op);
    if (!list.length) continue;
    const pick = S.statOverrideConflict === "first" ? list[0] : list[list.length - 1];
    set(pick.args.stat);
    if (list.length > 1) warnings.push({ code: "statOverrideConflict", op, used: pick.source });
  }

  // 3. Tags: union, same-name merged.
  const tags = mergeTags([
    action.tags,
    ...words.map((w) => w.tags),
    pre.filter((e) => e.op === "addTag").map((e) => ({ name: e.args?.name, value: e.args?.value }))
  ], S.sameNameTagStacking);

  // 4. Cost (§5.3).
  const lines = [{ label: action.name, value: Math.trunc(action.momentumCost ?? 0) }];
  for (const w of words) if (w.momentumModifier) lines.push({ label: w.name, value: Math.trunc(w.momentumModifier) });
  for (const e of pre.filter((x) => x.op === "cost")) lines.push({ label: e.source, value: Math.trunc(e.args?.delta ?? 0) });
  const resistanceApplies = hasTag(tags, "offensive") && target?.kind === "other";
  if (resistanceApplies) {
    const domain = resistanceDomain({ rollStat, targetStat }, S.resistanceTrack);
    const r = Math.trunc(target?.resistance?.[domain] ?? 0);
    if (r) lines.push({ label: "resistance", domain, value: r });
  }
  const raw = lines.reduce((s, l) => s + l.value, 0);
  const total = S.costFloorZero ? Math.max(0, raw) : raw;

  // 5. Effective momentum.
  const slow = tagValue(tags, "slow");
  const fast = tagValue(tags, "fast");
  const momentum = Math.trunc(actor.momentum ?? 0);
  const effectiveMomentum = momentum - slow + fast;

  // 6. Dice.
  const diceLines = [];
  for (const e of pre.filter((x) => x.op === "dice" && x.to !== "target")) {
    diceLines.push({ label: e.source, buff: Math.max(0, e.args?.buff | 0), debuff: Math.max(0, e.args?.debuff | 0) });
  }
  const wordCount = words.length;
  const extra = Math.max(0, wordCount - S.freeWords);
  if (extra && S.extraWordPenalty) diceLines.push({ label: "extraWords", buff: 0, debuff: extra * S.extraWordPenalty, n: extra });
  const maxWords = actor.maxWords ?? S.freeWords;
  if (S.focusBonus && wordCount < maxWords) diceLines.push({ label: "focus", buff: S.focusBonusDice, debuff: 0 });
  if (actor.sceneTrack && rollStat && isStatKey(rollStat) && parseStatKey(rollStat).domain === actor.sceneTrack && S.sceneTrackBonusDice) {
    diceLines.push({ label: "sceneTrack", buff: S.sceneTrackBonusDice, debuff: 0 });
  }
  const flatLines = pre.filter((x) => x.op === "flat").map((e) => ({ label: e.source, value: Math.trunc(e.args?.value ?? 0) }));
  // Unknown words (§6.2): anyone may use any word; not knowing it costs its penalty on the roll.
  for (const w of words) {
    const p = Math.abs(Math.trunc(w.penalty ?? 0)); // entered as 2 or -2
    if (w.known === false && p) flatLines.push({ label: w.name, value: -p, kind: "unknownWord" });
  }
  if (target?.exposed) {
    if (S.exposedMode === "dice") diceLines.push({ label: "exposed", buff: target.exposed, debuff: 0 });
    else flatLines.push({ label: "exposed", value: target.exposed });
  }
  let buff = diceLines.reduce((s, l) => s + l.buff, 0);
  let debuff = diceLines.reduce((s, l) => s + l.debuff, 0);
  if (S.diceCap > 0) {
    buff = Math.min(buff, S.diceCap);
    debuff = Math.min(debuff, S.diceCap);
  }

  // Tier shifts on the rolling stat from this action's own pre-roll effects.
  const tierShifts = pre
    .filter((e) => e.op === "tierShift" && e.to !== "target" && (e.args?.appliesTo ?? "roll") === "roll")
    .filter((e) => !e.args?.stat || e.args.stat === rollStat)
    .map((e) => ({ label: e.source, delta: Math.trunc(e.args?.delta ?? 0) }));
  for (const w of words) {
    const t = Math.max(0, Math.trunc(w.tierDowngrade ?? 0));
    if (w.known === false && t) tierShifts.push({ label: w.name, delta: -t, kind: "unknownWord" });
  }

  // Fixed DC.
  const dcEffects = pre.filter((x) => x.op === "dc");
  const dcPick = dcEffects[dcEffects.length - 1];
  const fixedDC = dcPick && !dcPick.args?.task && Number.isFinite(dcPick.args?.value) ? dcPick.args.value : null;
  const useTaskDC = Boolean(dcPick?.args?.task);

  // Outcomes are offered to the GM at resolution (§7.8), not applied here.
  const outcomes = {
    onHit: all.filter((e) => e.trigger === "onHit"),
    onMiss: all.filter((e) => e.trigger === "onMiss"),
    onResolve: all.filter((e) => e.trigger === "onResolve")
  };

  // Validation.
  const rolls = action.rolls !== false;
  if (wordCount > maxWords) errors.push({ code: "tooManyWords", max: maxWords });
  const names = words.map((w) => w.name);
  if (new Set(names).size !== names.length) warnings.push({ code: "duplicateWord" });
  const recovery = hasTag(tags, "recovery");
  if (momentum <= 0 && !recovery) errors.push({ code: "needsRecovery" });
  else if (total > momentum && !recovery) errors.push({ code: "unaffordable", cost: total, momentum });
  if (rolls && !isStatKey(rollStat)) errors.push({ code: "noRollStat" });
  if (rolls && !isStatKey(targetStat) && fixedDC == null && !useTaskDC && target?.kind === "other") errors.push({ code: "noTargetStat" });
  if (hasTag(tags, "offensive") && target?.kind === "self") warnings.push({ code: "offensiveOnSelf" });

  return {
    name: action.name,
    label: [action.name, ...names].join(" + "),
    rollStat,
    targetStat,
    rolls,
    tags,
    cost: { total, raw, lines, resistanceApplies },
    slow,
    fast,
    effectiveMomentum,
    dice: { buff, debuff, lines: diceLines },
    flatBonus: flatLines.reduce((s, l) => s + l.value, 0),
    unknownWords: words.filter((w) => w.known === false).map((w) => ({
      name: w.name, penalty: Math.abs(Math.trunc(w.penalty ?? 0)), tierDowngrade: Math.max(0, Math.trunc(w.tierDowngrade ?? 0))
    })),
    flatLines,
    tierShifts,
    fixedDC,
    useTaskDC,
    outcomes,
    declareEffects: all.filter((e) => e.trigger === "declare" || e.trigger === "finalize"),
    wordCount,
    maxWords,
    errors,
    warnings,
    valid: errors.length === 0
  };
}

/** Which resistance applies (§5.3) [OPEN #11]. */
export function resistanceDomain({ rollStat, targetStat }, mode = "targetStat") {
  const key = mode === "actionDomain" ? rollStat : targetStat || rollStat;
  return isStatKey(key) ? parseStatKey(key).domain : "physical";
}
