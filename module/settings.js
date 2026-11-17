/**
 * World settings (§16). Every OPEN or DRAFT rule is exposed here so designers
 * can change it without code changes. Settings not yet consumed by code are
 * registered now so the full list is visible from day one; the `phase` noted
 * in each hint says when the engine starts reading it.
 */
import { SYSTEM_ID } from "./config.js";
import { evaluateFormula } from "./rules/formula.js";

const S = (key) => `MODULUS.Settings.${key}`;

/** key, type, default, extra options */
const DEFINITIONS = [
  ["dc.primary", Number, 14],
  ["dc.secondary", Number, 11],
  ["dc.tertiary", Number, 8],
  ["defaultTaskDC", Number, 11],
  ["momentum.ceiling", String, "5 + level", { formula: ["level"] }],
  ["momentum.startingDefault", Number, 3],
  ["momentum.gainDefault", Number, 1],
  ["momentum.floor", String, "", { hint: "blank = none" }],
  ["costSpendTiming", String, "resolve", { choices: ["resolve", "declare"] }],
  ["costFloorZero", Boolean, true],
  ["resistanceTrack", String, "targetStat", { choices: ["targetStat", "actionDomain"] }],
  ["maxWordsFormula", String, "2 + floor(level / 4)", { formula: ["level"] }],
  ["extraWordPenalty", Number, 1],
  ["focusBonus", Boolean, false],
  ["sceneTrackBonusDice", Number, 1],
  ["exposedMode", String, "flat", { choices: ["flat", "dice"] }],
  ["defeatAffectsDefense", Boolean, true],
  ["diceStacking", String, "additive", { choices: ["additive"] }],
  ["diceCap", Number, 0],
  ["sameNameTagStacking", String, "sum", { choices: ["sum", "max", "last"] }],
  ["statOverrideConflict", String, "last", { choices: ["last", "first"] }],
  ["cascadeDepthCap", Number, 0],
  ["chargeResolvesOn", String, "xth", { choices: ["xth", "after"] }],
  ["interruptMode", String, "manual", { choices: ["manual"] }],
  ["autoApplyOutcomes", Boolean, false],
  ["pips.primary", Number, 4],
  ["pips.secondary", Number, 3],
  ["pips.tertiary", Number, 2],
  ["pips.minLevel", Number, 1],
  ["condFx.defaultDuration", Number, 1],
  ["condFx.aboveRank", String, "clamp", { choices: ["clamp", "buffDie"] }],
  ["condFx.defaultLimitPerRound", Number, 1],
  ["condFx.chainDepth", Number, 3],
  ["condFx.shiftsAffectDefense", Boolean, true],
  ["enableDeck", Boolean, false],
  ["roomEntryMomentum", String, "highestCapped", { choices: ["highestCapped", "baseline"] }],
  ["showAdvancedBonus", Boolean, false]
];

export function registerSettings() {
  for (const [key, type, def, opts = {}] of DEFINITIONS) {
    const setting = {
      name: S(`${key}.Name`),
      hint: S(`${key}.Hint`),
      scope: "world",
      config: true,
      type,
      default: def,
      requiresReload: false,
      onChange: () => refreshActors()
    };
    if (opts.choices) {
      setting.choices = Object.fromEntries(opts.choices.map((c) => [c, S(`${key}.Choice.${c}`)]));
    }
    if (opts.formula) {
      // Validate formulas on change; fall back to default if broken.
      setting.onChange = (value) => {
        try {
          evaluateFormula(value, Object.fromEntries(opts.formula.map((v) => [v, 1])));
        } catch (err) {
          ui.notifications.error(err.message);
        }
        refreshActors();
      };
    }
    game.settings.register(SYSTEM_ID, key, setting);
  }
}

export function getSetting(key) {
  return game.settings.get(SYSTEM_ID, key);
}

/** Evaluate a formula setting, falling back to its default if the stored text is invalid. */
export function getFormula(key, vars) {
  try {
    return evaluateFormula(getSetting(key), vars);
  } catch (err) {
    console.warn(`Modulus | ${err.message}; using default`);
    const def = DEFINITIONS.find((d) => d[0] === key)[2];
    return evaluateFormula(def, vars);
  }
}

export function dcTable() {
  return {
    primary: getSetting("dc.primary"),
    secondary: getSetting("dc.secondary"),
    tertiary: getSetting("dc.tertiary")
  };
}

export function pipsTable() {
  return {
    primary: getSetting("pips.primary"),
    secondary: getSetting("pips.secondary"),
    tertiary: getSetting("pips.tertiary")
  };
}

/** Derived data depends on settings; re-prepare and re-render open sheets. */
function refreshActors() {
  if (!game.ready) return;
  for (const actor of game.actors) {
    actor.reset();
    actor.sheet?.rendered && actor.sheet.render();
  }
}

export const SETTING_KEYS = DEFINITIONS.map((d) => d[0]);
