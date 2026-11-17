// Effective tier (§3.3), partial coverage of tests 11 and 19.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveTier, dcForTier } from "../module/rules/tier.js";

test("secondary stat, one defeated track -> rolls as tertiary", () => {
  assert.deepEqual(effectiveTier({ baseTier: "secondary", defeatedTracks: 1 }),
    { tier: "tertiary", tierIndex: 0, extraDebuffDice: 0, extraBuffDice: 0, steps: -1 });
});

test("tertiary stat, two defeated tracks -> tertiary plus 2 debuff dice", () => {
  // Each step below tertiary is one debuff die (§3.3). Test 11 in §17.2 says 1; see OPEN_QUESTIONS #42.
  const r = effectiveTier({ baseTier: "tertiary", defeatedTracks: 2 });
  assert.equal(r.tier, "tertiary");
  assert.equal(r.extraDebuffDice, 2);
});

test("clamping and summing before clamp", () => {
  assert.equal(effectiveTier({ baseTier: "tertiary", shifts: [2] }).tier, "primary");
  assert.equal(effectiveTier({ baseTier: "tertiary", shifts: [-1] }).extraDebuffDice, 1);
  assert.deepEqual(effectiveTier({ baseTier: "primary", shifts: [1] }).tier, "primary");
  assert.equal(effectiveTier({ baseTier: "primary", shifts: [1] }).extraBuffDice, 0);
  assert.equal(effectiveTier({ baseTier: "primary", shifts: [1], aboveRank: "buffDie" }).extraBuffDice, 1);
  assert.equal(effectiveTier({ baseTier: "secondary", defeatedTracks: 1, shifts: [1] }).tier, "secondary");
});

test("DC lookup", () => {
  assert.equal(dcForTier("primary"), 14);
  assert.equal(dcForTier("tertiary", { primary: 13, secondary: 11, tertiary: 9 }), 9);
});
