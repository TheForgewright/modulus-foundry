// Test 4 (§17.2) and action assembly (§6.6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleAction, resistanceDomain } from "../module/rules/assembly.js";
import { mergeTags, parseTags, formatTags, buildRegistry, hasTag } from "../module/rules/tags.js";

// §17.3 fixtures
const STRIKE = { name: "Strike", rollStat: "physical.power", targetStat: "physical.finesse", momentumCost: 1, tags: [{ name: "strike", value: 0 }, { name: "offensive", value: 0 }], effects: [] };
const GRAPPLE = { name: "Grapple", rollStat: "physical.power", targetStat: "physical.power", momentumCost: 1, tags: [{ name: "control", value: 0 }, { name: "offensive", value: 0 }], effects: [] };
const RECUPERATE = { name: "Recuperate", rollStat: "physical.resilience", targetStat: "", momentumCost: 0, tags: [{ name: "recovery", value: 0 }], effects: [{ trigger: "onHit", op: "momentum", args: { set: 3 }, to: "self" }, { trigger: "declare", op: "dc", args: { task: true }, to: "self" }] };
const CHARGING = { name: "Charging", momentumModifier: 1, tags: [{ name: "movement", value: 0 }], effects: [] };
const STEADY = { name: "Steady", momentumModifier: -1, tags: [{ name: "slow", value: 2 }], effects: [] };
const DARTING = { name: "Darting", momentumModifier: 1, tags: [{ name: "fast", value: 1 }], effects: [] };
const WRENCHING = {
  name: "Wrenching", momentumModifier: 0, tags: [],
  effects: [
    { trigger: "declare", op: "targetStat", args: { stat: "physical.resilience" }, to: "self" },
    { trigger: "onHit", op: "restrict", args: { tag: "two-handed", until: "the target wins a break contest", breakRoll: "physical.power", breakTarget: "physical.power" }, to: "target" }
  ]
};

const other = (res = 2) => ({ kind: "other", resistance: { physical: res, mental: 0, social: 0 } });
const actor = { momentum: 6, maxWords: 2 };

test("test 4: cost 1, words +1 and -1, offensive, target resistance 2 -> 3", () => {
  const a = assembleAction({ action: STRIKE, words: [CHARGING, STEADY], actor, target: other(2) });
  assert.equal(a.cost.total, 3);
  assert.equal(a.cost.resistanceApplies, true);
});

test("test 4: without offensive, or targeting self -> 1", () => {
  const noOff = { ...STRIKE, tags: [{ name: "strike", value: 0 }] };
  assert.equal(assembleAction({ action: noOff, words: [CHARGING, STEADY], actor, target: other(2) }).cost.total, 1);
  assert.equal(assembleAction({ action: STRIKE, words: [CHARGING, STEADY], actor, target: { kind: "self" } }).cost.total, 1);
  assert.equal(assembleAction({ action: STRIKE, words: [CHARGING, STEADY], actor, target: null }).cost.total, 1);
});

test("resistance track: target stat domain by default, roll stat domain as the alternative", () => {
  const mental = { ...STRIKE, targetStat: "mental.finesse" };
  const t = { kind: "other", resistance: { physical: 5, mental: 1, social: 0 } };
  assert.equal(assembleAction({ action: mental, actor, target: t }).cost.total, 2);
  assert.equal(assembleAction({ action: mental, actor, target: t, settings: { resistanceTrack: "actionDomain" } }).cost.total, 6);
  assert.equal(resistanceDomain({ rollStat: "social.power", targetStat: "" }), "social");
});

test("cost floor zero (default) and negative costs", () => {
  const cheap = { ...STRIKE, momentumCost: 0, tags: [] };
  assert.equal(assembleAction({ action: cheap, words: [STEADY], actor }).cost.total, 0);
  assert.equal(assembleAction({ action: cheap, words: [STEADY], actor, settings: { costFloorZero: false } }).cost.total, -1);
});

test("tags: union, words add, same-name values sum by default", () => {
  const a = assembleAction({ action: STRIKE, words: [STEADY, { name: "Lumbering", tags: [{ name: "slow", value: 1 }] }], actor });
  assert.deepEqual(a.tags.map((t) => [t.name, t.value]), [["strike", 0], ["offensive", 0], ["slow", 3]]);
  assert.equal(a.slow, 3);
  assert.equal(a.effectiveMomentum, 3);
  assert.deepEqual(mergeTags([[{ name: "slow", value: 2 }], [{ name: "Slow", value: 1 }]], "max"), [{ name: "slow", value: 2 }]);
  assert.deepEqual(mergeTags([[{ name: "slow", value: 2 }], [{ name: "slow", value: 1 }]], "last"), [{ name: "slow", value: 1 }]);
});

test("fast raises effective momentum", () => {
  const a = assembleAction({ action: STRIKE, words: [DARTING], actor: { momentum: 5, maxWords: 2 } });
  assert.equal(a.effectiveMomentum, 6);
});

test("stat overrides: last word wins by default, first as the alternative", () => {
  const w = WRENCHING;
  const other2 = { name: "Feinting", effects: [{ trigger: "declare", op: "targetStat", args: { stat: "mental.finesse" }, to: "self" }] };
  assert.equal(assembleAction({ action: GRAPPLE, words: [w], actor }).targetStat, "physical.resilience");
  assert.equal(assembleAction({ action: GRAPPLE, words: [w, other2], actor }).targetStat, "mental.finesse");
  const first = assembleAction({ action: GRAPPLE, words: [w, other2], actor, settings: { statOverrideConflict: "first" } });
  assert.equal(first.targetStat, "physical.resilience");
  assert.ok(first.warnings.some((x) => x.code === "statOverrideConflict"));
});

test("outcomes are collected, not applied", () => {
  const a = assembleAction({ action: GRAPPLE, words: [WRENCHING], actor, target: other(0) });
  assert.equal(a.outcomes.onHit.length, 1);
  assert.equal(a.outcomes.onHit[0].op, "restrict");
  assert.equal(a.outcomes.onHit[0].source, "Wrenching");
});

test("dice: word effects, extra-word penalty, focus hook, scene track, cap", () => {
  const buffWord = { name: "Precise", effects: [{ trigger: "declare", op: "dice", args: { buff: 1, debuff: 0 }, to: "self" }] };
  const w = (n) => ({ name: `W${n}`, momentumModifier: 0 });
  let a = assembleAction({ action: STRIKE, words: [buffWord, w(1), w(2), w(3)], actor: { momentum: 9, maxWords: 4 } });
  assert.equal(a.dice.buff, 1);
  assert.equal(a.dice.debuff, 2); // two words past the second
  a = assembleAction({ action: STRIKE, words: [], actor, settings: { focusBonus: true } });
  assert.equal(a.dice.buff, 1);
  a = assembleAction({ action: STRIKE, words: [w(1), w(2)], actor, settings: { focusBonus: true } });
  assert.equal(a.dice.buff, 0);
  a = assembleAction({ action: STRIKE, actor: { ...actor, sceneTrack: "physical" } });
  assert.equal(a.dice.buff, 1);
  a = assembleAction({ action: STRIKE, actor: { ...actor, sceneTrack: "social" } });
  assert.equal(a.dice.buff, 0);
  const big = { name: "Big", effects: [{ trigger: "declare", op: "dice", args: { buff: 5, debuff: 0 }, to: "self" }] };
  assert.equal(assembleAction({ action: STRIKE, words: [big], actor, settings: { diceCap: 2 } }).dice.buff, 2);
});

test("statuses contribute while-effects", () => {
  const a = assembleAction({ action: STRIKE, actor, statuses: [{ name: "Shaken", effects: [{ trigger: "while", op: "dice", args: { buff: 0, debuff: 1 }, to: "self" }, { trigger: "onHit", op: "note", args: { text: "x" } }] }] });
  assert.equal(a.dice.debuff, 1);
  assert.equal(a.outcomes.onHit.length, 0);
});

test("exposed target: flat by default, dice as the alternative", () => {
  const t = { ...other(0), exposed: 2 };
  assert.equal(assembleAction({ action: STRIKE, actor, target: t }).flatBonus, 2);
  const d = assembleAction({ action: STRIKE, actor, target: t, settings: { exposedMode: "dice" } });
  assert.equal(d.flatBonus, 0);
  assert.equal(d.dice.buff, 2);
});

test("test 13: at zero or negative momentum only recovery actions can be declared", () => {
  assert.ok(assembleAction({ action: STRIKE, actor: { momentum: 0, maxWords: 2 } }).errors.some((e) => e.code === "needsRecovery"));
  assert.ok(assembleAction({ action: STRIKE, actor: { momentum: -2, maxWords: 2 } }).errors.some((e) => e.code === "needsRecovery"));
  const r = assembleAction({ action: RECUPERATE, actor: { momentum: -2, maxWords: 2 } });
  assert.equal(r.valid, true);
  assert.equal(r.useTaskDC, true);
});

test("validation: too many words, unaffordable", () => {
  assert.ok(assembleAction({ action: STRIKE, words: [CHARGING, DARTING, STEADY], actor }).errors.some((e) => e.code === "tooManyWords"));
  assert.ok(assembleAction({ action: STRIKE, words: [CHARGING], actor: { momentum: 1, maxWords: 2 } }).errors.some((e) => e.code === "unaffordable"));
  assert.equal(assembleAction({ action: STRIKE, words: [CHARGING], actor: { momentum: 2, maxWords: 2 } }).valid, true);
});

test("tag helpers", () => {
  assert.deepEqual(parseTags("Slow 2, offensive, armor  penetrating 1"), [
    { name: "slow", value: 2 }, { name: "offensive", value: 0 }, { name: "armor penetrating", value: 1 }
  ]);
  assert.equal(formatTags([{ name: "slow", value: 2 }, { name: "offensive", value: 0 }]), "slow 2, offensive");
  const reg = buildRegistry([{ name: "slow", description: "hijack" }, { name: "Ki", valued: true }]);
  assert.equal(reg.find((t) => t.name === "slow").engine, true);
  assert.ok(reg.find((t) => t.name === "ki"));
  assert.ok(hasTag([{ name: "Offensive" }], "offensive"));
});
