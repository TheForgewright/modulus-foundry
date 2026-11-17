import { test } from "node:test";
import assert from "node:assert/strict";
import { exportVocabulary, parseVocabulary, planImport, mergeTagRegistry } from "../module/rules/vocab-io.js";

const items = [
  { vocabId: "w1", type: "word", name: "Steady", system: { momentumModifier: -1, tags: [{ name: "slow", value: 2 }], groups: { tree: "Stance" } } },
  { vocabId: "a1", type: "action", name: "Strike", img: "icons/svg/sword.svg", system: { rollStat: "physical.power", momentumCost: 1, effects: [{ trigger: "onHit", op: "pips", args: { delta: 1, track: "physical" }, to: "target" }] } },
  { vocabId: "x", type: "armor", name: "Not vocabulary", system: {} }
];

test("export -> JSON -> import -> export round-trips", () => {
  const a = exportVocabulary(items, [{ name: "ki", valued: true }], { exportedAt: "T" });
  assert.equal(a.items.length, 2); // armor is not vocabulary
  const parsed = parseVocabulary(JSON.stringify(a));
  assert.equal(parsed.valid, true, parsed.errors.join());
  const b = exportVocabulary(parsed.items, parsed.tags, { exportedAt: "T" });
  assert.deepEqual(b, a);
  assert.equal(a.items[0].type, "action"); // stable order
  assert.equal(a.items[1].system.groups.tree, "Stance"); // groups survive
});

test("import rejects bad files with reasons", () => {
  assert.equal(parseVocabulary("{nope").valid, false);
  const r = parseVocabulary({ format: "other", version: 1, items: [{ type: "action", name: "A" }, { vocabId: "1", type: "spell", name: "B" }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes("wrongFormat"));
  assert.ok(r.errors.some((e) => e.includes("noVocabId")));
  assert.ok(r.errors.some((e) => e.includes("badType")));
  const dup = parseVocabulary({ format: "modulus-vocabulary", version: 1, items: [{ vocabId: "1", type: "word", name: "A" }, { vocabId: "1", type: "word", name: "B" }] });
  assert.ok(dup.errors.some((e) => e.includes("duplicateVocabId")));
});

test("plan: existing vocabIds update, new ones create", () => {
  const p = planImport([{ vocabId: "a1" }, { vocabId: "new" }], new Map([["a1", "docA"]]));
  assert.deepEqual(p.update.map((i) => i.id), ["docA"]);
  assert.deepEqual(p.create.map((i) => i.vocabId), ["new"]);
});

test("tag registry merge", () => {
  const m = mergeTagRegistry([{ name: "ki", description: "old" }, { name: "a" }], [{ name: "ki", description: "new" }]);
  assert.deepEqual(m.map((t) => t.description ?? ""), ["", "new"]);
});
