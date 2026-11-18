import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECT_OPS, coerceEffect, validateEffect, describeEffect, newEffect } from "../module/rules/effects.js";
import { isStatKey } from "../module/rules/constants.js";

test("every op has a default that validates (or is a JSON op)", () => {
  for (const op of Object.keys(EFFECT_OPS)) {
    const e = newEffect(op);
    if (EFFECT_OPS[op].json) continue;
    const errs = validateEffect(e, { isStatKey }).filter((x) => !x.startsWith("badStat") && !x.startsWith("empty") && x !== "dcNeedsValue");
    assert.deepEqual(errs, [], op);
    assert.equal(typeof describeEffect(e), "string");
  }
});

test("coerce form strings into typed args", () => {
  const e = coerceEffect({ trigger: "onHit", op: "dice", args: { buff: "2", debuff: "" }, to: "target" });
  assert.deepEqual(e, { trigger: "onHit", op: "dice", args: { buff: 2, debuff: 0 }, to: "target" });
  const t = coerceEffect({ trigger: "x", op: "tierShift", args: { delta: "-1", stat: "", appliesTo: "nope" } });
  assert.deepEqual(t, { trigger: "onResolve", op: "tierShift", args: { delta: -1, appliesTo: "roll" }, to: "self" });
  const j = coerceEffect({ trigger: "while", op: "deckModify", args: { add: { jokers: 1 } } });
  assert.deepEqual(j.args, { add: { jokers: 1 } });
});

test("validation", () => {
  assert.deepEqual(validateEffect({ trigger: "onHit", op: "rollStat", args: { stat: "nope" }, to: "self" }, { isStatKey }), ["badStat:stat"]);
  assert.deepEqual(validateEffect({ op: "boom" }), ["unknownOp:boom"]);
});

test("descriptions read as plain language", () => {
  const stat = (k) => ({ "physical.resilience": "Resistance", "physical.power": "Strength" }[k] ?? k);
  assert.equal(describeEffect({ trigger: "declare", op: "targetStat", args: { stat: "physical.resilience" }, to: "self" }, { stat }), "When declared: test the target's Resistance.");
  assert.equal(describeEffect({ trigger: "onHit", op: "restrict", args: { tag: "two-handed", until: "they break free", breakRoll: "physical.power", breakTarget: "physical.power" }, to: "target" }, { stat }),
    "On hit: the target cannot use two-handed actions until they break free (break: Strength vs Strength).");
  assert.equal(describeEffect({ trigger: "declare", op: "dice", args: { buff: 2, debuff: 1 }, to: "self" }), "When declared: 2 buff dice and 1 debuff die on your roll.");
  assert.equal(describeEffect({ trigger: "onHit", op: "momentum", args: { set: 3 }, to: "self" }), "On hit: set your momentum to 3.");
});

test("change team effect: modes, validation and description", () => {
  const e = (mode, to = "target", name) => ({ trigger: "onHit", op: "team", args: { mode, ...(name ? { name } : {}) }, to });
  assert.deepEqual(validateEffect(e("set"), { isStatKey }), ["teamNeedsName"]);
  assert.deepEqual(validateEffect(e("set", "target", "Crown"), { isStatKey }), []);
  assert.deepEqual(validateEffect(e("clear"), { isStatKey }), []);
  assert.equal(describeEffect(e("joinActor")), "On hit: the target joins your team.");
  assert.equal(describeEffect(e("joinTarget", "self")), "On hit: you join the target's team.");
  assert.equal(describeEffect(e("clear", "self")), "On hit: you drop into free for all.");
  assert.equal(describeEffect(e("set", "target", "Crown")), "On hit: the target joins team Crown.");
  assert.deepEqual(coerceEffect({ trigger: "onHit", op: "team", args: { mode: "bogus", name: "" } }).args, { mode: "clear" });
});
