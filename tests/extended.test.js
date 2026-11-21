import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLabels, filterEncounters, roomEntryMomentum, linkedMomentumOps, actionMomentumChanges,
  crossedThresholds, talentThresholds
} from "../module/rules/extended.js";

test("labels: comma text or array, trimmed, no blanks or repeats (case-insensitive)", () => {
  assert.deepEqual(parseLabels("court, Act 2 ,, Court"), ["court", "Act 2"]);
  assert.deepEqual(parseLabels(["a", " b ", "A", ""]), ["a", "b"]);
  assert.deepEqual(parseLabels(null), []);
  assert.equal(parseLabels("x".repeat(60))[0].length, 40);
});

test("encounter list filter: kind, label, closed hidden unless asked, text search", () => {
  const list = [
    { name: "Ava & Bram", kind: "relationship", labels: ["court"], closed: false },
    { name: "The Hollow Murders", kind: "investigation", labels: ["Act 2"], closed: false },
    { name: "Old feud", kind: "relationship", labels: [], closed: true },
    { name: "Tavern brawl", kind: "standard", labels: ["court"], closed: false }
  ];
  assert.equal(filterEncounters(list).length, 3);
  assert.equal(filterEncounters(list, { closed: true }).length, 4);
  assert.deepEqual(filterEncounters(list, { kind: "relationship" }).map((e) => e.name), ["Ava & Bram"]);
  assert.deepEqual(filterEncounters(list, { label: "COURT" }).map((e) => e.name), ["Ava & Bram", "Tavern brawl"]);
  assert.deepEqual(filterEncounters(list, { text: "hollow" }).map((e) => e.name), ["The Hollow Murders"]);
  assert.deepEqual(filterEncounters(list, { text: "act 2" }).map((e) => e.name), ["The Hollow Murders"]);
});

test("room entry: highest relevant relationship, capped at the ceiling", () => {
  const relationships = [
    { id: "r1", momentum: 6, counterparts: ["bram"] },
    { id: "r2", momentum: 9, counterparts: ["cora"] },
    { id: "r3", momentum: 12, counterparts: ["dax"] }
  ];
  assert.deepEqual(roomEntryMomentum({ starting: 3, ceiling: 8, relationships, present: ["bram"] }), { value: 6, from: "r1" });
  assert.deepEqual(roomEntryMomentum({ starting: 3, ceiling: 8, relationships, present: ["bram", "cora"] }), { value: 8, from: "r2" });
  // Nobody they know is here: baseline.
  assert.deepEqual(roomEntryMomentum({ starting: 3, ceiling: 8, relationships, present: ["eve"] }), { value: 3, from: null });
  // A soured relationship below baseline still counts (witnesses, §7.11).
  assert.deepEqual(roomEntryMomentum({ starting: 3, ceiling: 8, relationships: [{ id: "r4", momentum: 1, counterparts: ["bram"] }], present: ["bram"] }), { value: 1, from: "r4" });
});

test("linked momentum: cost and momentum outcomes applied in each linked encounter, once", () => {
  const changes = actionMomentumChanges({
    cost: 2, costSpent: true,
    rows: [
      { index: 0, effect: { op: "momentum", to: "target", args: { delta: -1 } } },
      { index: 1, effect: { op: "pips", to: "target", args: { delta: 1 } } },
      { index: 2, effect: { op: "momentum", to: "self", args: { set: 3 } } },
      { index: 3, effect: { op: "momentum", to: "self", args: { delta: 1 } } }
    ],
    applied: { 0: true, 1: true, 2: true, 3: "scheduled" }
  });
  assert.deepEqual(changes, [
    { key: "cost", who: "actor", delta: -2 },
    { key: "row0", who: "target", delta: -1 },
    { key: "row2", who: "actor", set: 3 }
  ]);
  const encounters = [
    { combatId: "rel", actorPid: "a1", targetPid: "b1" },
    { combatId: "inv", actorPid: "a2", targetPid: null } // the target is not in this one
  ];
  const ops = linkedMomentumOps({ changes, encounters, ledger: { "rel:cost": true } });
  assert.deepEqual(ops.map((o) => [o.combatId, o.pid, o.key, o.delta ?? `=${o.set}`]), [
    ["rel", "b1", "row0", -1],
    ["rel", "a1", "row2", "=3"],
    ["inv", "a2", "cost", -2],
    ["inv", "a2", "row2", "=3"]
  ]);
  assert.equal(ops[0].ledgerKey, "rel:row0");
  // Cost not taken (the player unticked Spend): nothing to link for it.
  assert.deepEqual(actionMomentumChanges({ cost: 2, costSpent: false }), []);
});

test("thresholds: talent values met in either direction, below zero, ceiling", () => {
  const thresholds = [{ value: 5, direction: "any", source: "Iron Grip" }, { value: 2, direction: "down", source: "Last stand" }, { value: 2, direction: "up", source: "Rally" }];
  assert.deepEqual(crossedThresholds({ from: 3, to: 6, ceiling: 8, thresholds }), [{ type: "talent", value: 5, direction: "up", source: "Iron Grip" }]);
  assert.deepEqual(crossedThresholds({ from: 5, to: 5, ceiling: 8, thresholds }), []);
  assert.deepEqual(crossedThresholds({ from: 4, to: -1, ceiling: 8, thresholds }).map((t) => t.type + t.value), ["talent2", "belowZero0"]);
  assert.deepEqual(crossedThresholds({ from: 1, to: 2, ceiling: 8, thresholds }).map((t) => t.source), ["Rally"]);
  assert.deepEqual(crossedThresholds({ from: 6, to: 9, ceiling: 8 }), [{ type: "ceiling", value: 8, direction: "up" }]);
  // Leaving 5 downward from exactly 5 does not meet 5 again.
  assert.deepEqual(crossedThresholds({ from: 5, to: 4, ceiling: 8, thresholds: [{ value: 5 }] }), []);
});

test("talent thresholds follow the trigger's scope and the encounter kind", () => {
  const fx = (event, actor, params, label = "") => ({ label, trigger: { event, actor, params } });
  const talents = [
    { ownerId: "a", talentName: "Steady Nerve", effects: [fx("momentumCrossed", "self", { value: 5 }, "Calm")] },
    { ownerId: "b", talentName: "Predator", effects: [fx("momentumCrossed", "other", { value: 1, direction: "down" })] },
    { ownerId: "b", talentName: "Old Friends", effects: [fx("extendedMomentum", "any", { kind: "relationship", value: 7 })] },
    { ownerId: "b", talentName: "Noise", effects: [fx("roundStart", "self", {})] }
  ];
  assert.deepEqual(talentThresholds(talents, "a", "standard").map((t) => t.source), ["Steady Nerve: Calm", "Predator"]);
  assert.deepEqual(talentThresholds(talents, "a", "relationship").map((t) => t.source), ["Steady Nerve: Calm", "Predator", "Old Friends"]);
  assert.deepEqual(talentThresholds(talents, "b", "investigation").map((t) => t.source), []);
});
