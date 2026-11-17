// Test 2 (§17.2): dot allocation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDots, computeTiers, shapeSummary, validateAllocation } from "../module/rules/allocation.js";

test("Physical Power, free dot on Social Power -> 2 primary, 3 secondary, 4 tertiary", () => {
  const a = { domain: "physical", expression: "power", freeDot: "social.power" };
  assert.ok(validateAllocation(a).valid);
  assert.deepEqual(shapeSummary(a), { primary: 2, secondary: 3, tertiary: 4 });
  const dots = computeDots(a);
  assert.equal(dots["physical.power"], 2);
  assert.equal(dots["social.power"], 2);
  assert.equal(dots["mental.power"], 1);
  assert.equal(dots["physical.finesse"], 1);
  assert.equal(dots["physical.resilience"], 1);
  assert.equal(dots["mental.finesse"], 0);
});

test("free dot on the intersection is rejected", () => {
  const v = validateAllocation({ domain: "physical", expression: "power", freeDot: "physical.power" });
  assert.equal(v.valid, false);
  assert.ok(v.errors.includes("MODULUS.Allocation.Error.FreeDotOnIntersection"));
  // and never pushes a stat above 2 dots
  assert.equal(computeDots({ domain: "physical", expression: "power", freeDot: "physical.power" })["physical.power"], 2);
});

test("free dot on a tertiary -> 1 primary, 5 secondary, 3 tertiary", () => {
  const a = { domain: "mental", expression: "finesse", freeDot: "social.resilience" };
  assert.deepEqual(shapeSummary(a), { primary: 1, secondary: 5, tertiary: 3 });
  assert.equal(computeTiers(a)["social.resilience"], "secondary");
});

test("base shape before the free dot is 1 / 4 / 4", () => {
  assert.deepEqual(shapeSummary({ domain: "social", expression: "resilience" }), { primary: 1, secondary: 4, tertiary: 4 });
});

test("incomplete or invalid allocations report errors", () => {
  const v = validateAllocation({});
  assert.equal(v.valid, false);
  assert.equal(v.complete, false);
  assert.equal(validateAllocation({ domain: "astral", expression: "power", freeDot: "mental.power" }).valid, false);
  assert.equal(validateAllocation({ domain: "physical", expression: "power", freeDot: "nope" }).valid, false);
});
