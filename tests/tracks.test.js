// Test 3 (§17.2): pips, plus break points and rests (§4.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackMax, describeTrack, shortRest, longRest, applyPips, breakPointsCrossed } from "../module/rules/tracks.js";

test("level 2 pips: tertiary 4, secondary 6, primary 8", () => {
  assert.equal(trackMax({ tier: "tertiary", level: 2 }), 4);
  assert.equal(trackMax({ tier: "secondary", level: 2 }), 6);
  assert.equal(trackMax({ tier: "primary", level: 2 }), 8);
});

test("level 0 is treated as level 1 by default [OPEN]", () => {
  assert.equal(trackMax({ tier: "primary", level: 0 }), 4);
  assert.equal(trackMax({ tier: "primary", level: 0, minLevel: 0 }), 0);
});

test("segments: one per level, last pip of each segment is a break point", () => {
  const t = describeTrack({ tier: "secondary", level: 2, pipsLost: 3 });
  assert.equal(t.segments.length, 2);
  assert.deepEqual(t.segments[0].pips.map((p) => p.breakPoint), [false, false, true]);
  assert.equal(t.segments[0].broken, true);
  assert.equal(t.segments[1].broken, false);
  assert.equal(t.breakPointsReached, 1);
  assert.equal(t.remaining, 3);
  assert.equal(t.depleted, false);
});

test("short rest restores the current segment unless its break point was reached", () => {
  assert.equal(shortRest(2, 3), 0);
  assert.equal(shortRest(3, 3), 3);
  assert.equal(shortRest(5, 3), 3);
});

test("long rest restores one segment", () => {
  assert.equal(longRest(6, 3), 3);
  assert.equal(longRest(2, 3), 0);
});

test("applyPips clamps, reports overflow and break points crossed", () => {
  const r = applyPips({ pipsLost: 2, amount: 5, max: 6, perLevel: 3 });
  assert.deepEqual(r, { pipsLost: 6, overflow: 1, breakPointsCrossed: 2, depleted: true });
  assert.equal(applyPips({ pipsLost: 1, amount: -3, max: 6, perLevel: 3 }).pipsLost, 0);
  assert.equal(breakPointsCrossed(3, 4, 3), 0);
});
