import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleDelayed, takeDueDelayed, cancelDelayed } from "../module/rules/delayed.js";
import { newEncounterState, startRound } from "../module/rules/encounter.js";
import { coerceEffect, validateEffect, describeEffect } from "../module/rules/effects.js";

const pips = { trigger: "onHit", op: "pips", args: { delta: 1, track: "physical" }, to: "target", delay: 2 };

test("a delayed effect fires at the start of the round it is due, once", () => {
  let s = startRound(newEncounterState()).state; // round 1
  const r = scheduleDelayed(s, { effect: pips, source: "Slow Poison", actorPid: "a", targetPid: "b" });
  s = r.state;
  assert.equal(r.entry.dueRound, 3);
  assert.equal(r.entry.effect.delay, undefined); // applying it when due does not re-schedule it
  s = startRound(s).state; // round 2
  assert.equal(takeDueDelayed(s).due.length, 0);
  s = startRound(s).state; // round 3
  const due = takeDueDelayed(s);
  assert.deepEqual(due.due.map((d) => d.source), ["Slow Poison"]);
  assert.equal(takeDueDelayed(due.state).due.length, 0);
});

test("delayed effects survive round changes and can be cancelled", () => {
  let s = startRound(newEncounterState()).state;
  s = scheduleDelayed(s, { effect: { ...pips, delay: 1 } }).state;
  s = scheduleDelayed(s, { effect: { ...pips, delay: 1 }, source: "Second" }).state;
  s = cancelDelayed(s, s.delayed[0].id);
  s = startRound(s).state;
  assert.deepEqual(takeDueDelayed(s).due.map((d) => d.source), ["Second"]);
});

test("delay on effects: kept by coerce, outcome triggers only, previewed", () => {
  assert.equal(coerceEffect(pips).delay, 2);
  assert.equal(coerceEffect({ ...pips, delay: "0" }).delay, undefined);
  assert.deepEqual(validateEffect({ ...pips, trigger: "declare" }), ["delayNeedsOutcome"]);
  assert.deepEqual(validateEffect(pips), []);
  assert.equal(describeEffect(pips), "On hit, 2 rounds later: the target loses 1 pip of physical.");
  assert.equal(describeEffect({ ...pips, delay: 1 }), "On hit, next round: the target loses 1 pip of physical.");
});
