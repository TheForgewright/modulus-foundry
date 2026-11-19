import { test } from "node:test";
import assert from "node:assert/strict";
import { thresholdFor, normalizeThresholds, DEFAULT_THRESHOLDS } from "../module/rules/thresholds.js";

test("the threshold is how many thresholds earned XP has reached", () => {
  assert.deepEqual(thresholdFor(0), { threshold: 0, next: 100, previous: 0, toNext: 100 });
  assert.equal(thresholdFor(99).threshold, 0);
  assert.equal(thresholdFor(100).threshold, 1);
  assert.deepEqual(thresholdFor(650), { threshold: 3, next: 1000, previous: 600, toNext: 350 });
  assert.deepEqual(thresholdFor(99999), { threshold: 10, next: null, previous: 5500, toNext: null });
  assert.equal(DEFAULT_THRESHOLDS.length, 10);
});

test("configured thresholds: any order, blanks and zeros are unused", () => {
  assert.deepEqual(normalizeThresholds([300, "", 0, 100, "50", null, -5]), [50, 100, 300]);
  assert.equal(thresholdFor(120, [300, "", 100, 0]).threshold, 1);
  assert.equal(thresholdFor(5, []).threshold, 0);
});
