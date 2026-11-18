// Keeping world copies of compendium entries current after a system update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSync, contentHash, syncContent, mergedSystem } from "../module/rules/compendium-sync.js";

const UUID = "Compendium.modulus.words.Item.abc";
const v1 = { name: "Steady", img: "a.svg", system: { momentumModifier: -1, tags: [{ name: "slow", value: 2 }] } };
const v2 = { name: "Steady", img: "a.svg", system: { momentumModifier: -2, tags: [{ name: "slow", value: 2 }] } };
const entries = (data, type = "word") => new Map([[UUID, { type, data }]]);
const copy = (data, syncHash, type = "word") => ({ key: "x", type, sourceUuid: UUID, syncHash, data });

test("the reported case: the compendium changed, the world copy was untouched -> update", () => {
  const plan = planSync([copy(v1, contentHash("word", v1))], entries(v2));
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].change.system.momentumModifier, -2);
  assert.equal(plan.update[0].change.syncHash, contentHash("word", v2));
});

test("unchanged entry -> current; a missing fingerprint is filled in", () => {
  const plan = planSync([copy(v1, undefined)], entries(v1));
  assert.equal(plan.current.length, 1);
  assert.equal(plan.current[0].needsHash, true);
});

test("edited in the world -> edited (ask first), never silently overwritten", () => {
  const local = { ...v1, system: { ...v1.system, momentumModifier: 0 } };
  const plan = planSync([copy(local, contentHash("word", v1))], entries(v2));
  assert.equal(plan.edited.length, 1);
  assert.equal(plan.update.length, 0);
});

test("no fingerprint and different content -> edited", () => {
  assert.equal(planSync([copy(v1, undefined)], entries(v2)).edited.length, 1);
});

test("entry removed from the compendium -> orphan", () => {
  assert.equal(planSync([copy(v1, "h")], new Map()).orphan.length, 1);
});

test("a copy's own fields are kept and not compared", () => {
  const entry = { name: "Shaken", img: "", system: { value: 1, duration: { type: "rounds", rounds: 3 }, effects: [] } };
  const mine = { name: "Shaken", img: "", system: { value: 2, duration: { type: "rounds", rounds: 1 }, effects: [] } };
  assert.equal(contentHash("status", entry), contentHash("status", mine));
  const newer = { ...entry, system: { ...entry.system, effects: [{ op: "note" }] } };
  const plan = planSync([copy(mine, contentHash("status", mine), "status")], entries(newer, "status"));
  assert.equal(plan.update.length, 1);
  const sys = plan.update[0].change.system;
  assert.equal(sys.value, 2);
  assert.equal(sys.duration.rounds, 1);
  assert.equal(sys.duration.type, "rounds");
  assert.deepEqual(sys.effects, [{ op: "note" }]);
  assert.equal(mergedSystem("skill", { rank: 0, wordPool: ["a"] }, { rank: 4 }).rank, 4);
  assert.deepEqual(syncContent("armor", { name: "Mail", system: { equipped: true, penalty: "x" } }).system, { penalty: "x" });
});

test("fingerprint ignores key order", () => {
  assert.equal(contentHash("word", { name: "a", img: "", system: { x: 1, y: 2 } }), contentHash("word", { img: "", system: { y: 2, x: 1 }, name: "a" }));
});
