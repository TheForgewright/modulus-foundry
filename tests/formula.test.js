import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../module/rules/formula.js";
import { momentumCeiling, gainMomentum } from "../module/rules/momentum.js";

test("formula evaluator", () => {
  assert.equal(evaluateFormula("2 + floor(level / 4)", { level: 7 }), 3);
  assert.equal(evaluateFormula("2 + floor(level/2)", { level: 7 }), 5);
  assert.equal(evaluateFormula("-(1 + 2) * 3"), -9);
  assert.equal(evaluateFormula("max(1, level)", { level: 0 }), 1);
  assert.throws(() => evaluateFormula("level + x", { level: 1 }));
  assert.throws(() => evaluateFormula("alert(1)"));
  assert.throws(() => evaluateFormula("1 +"));
});

test("momentum ceiling and gain", () => {
  assert.equal(momentumCeiling(0), 5);
  assert.equal(momentumCeiling(3), 8);
  assert.equal(gainMomentum({ current: 7, gain: 2, ceiling: 8 }), 8);
  assert.equal(gainMomentum({ current: 9, gain: 1, ceiling: 8 }), 9);
  assert.equal(gainMomentum({ current: -2, gain: 1, ceiling: 8 }), -1);
});
