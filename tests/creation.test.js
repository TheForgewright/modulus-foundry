import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCreation, creationCost, freeBackgrounds, respecCheck } from "../module/rules/creation.js";
import { talentEligibility, validateTalentGraph } from "../module/rules/talents.js";

const allocation = { domain: "physical", expression: "power", freeDot: "social.power" };
const bg = (id, category, xpCost = 0) => ({ id, name: id, category, xpCost });
const complete = {
  allocation,
  ancestry: { id: "elf", name: "Elf" },
  societies: [],
  backgrounds: [bg("farm", "childhood"), bg("smith", "job"), bg("dice", "leisure")],
  words: []
};
const codes = (r) => r.errors.map((e) => e.code);

test("a complete plan is valid and free", () => {
  const r = validateCreation(complete);
  assert.equal(r.valid, true);
  assert.equal(r.cost, 0);
});

test("the allocation, ancestry and each required background are checked", () => {
  const r = validateCreation({ allocation: { domain: "physical" }, backgrounds: [bg("farm", "childhood")] });
  assert.deepEqual(codes(r), ["allocation", "allocation", "needAncestry", "needBackground", "needBackground"]);
  assert.deepEqual(r.errors.filter((e) => e.code === "needBackground").map((e) => e.category), ["job", "leisure"]);
});

test("ancestry and background categories are only required when content exists", () => {
  const r = validateCreation({ allocation }, { ancestriesExist: false, backgroundCategories: ["job"] });
  assert.deepEqual(r.errors, [{ code: "needBackground", category: "job" }]);
  assert.equal(validateCreation({ allocation }, { ancestriesExist: false, backgroundCategories: [] }).valid, true);
});

test("the first background of each required category is free; extras cost their XP", () => {
  const backgrounds = [bg("farm", "childhood", 10), bg("street", "childhood", 15), bg("smith", "job", 20), bg("dice", "leisure"), bg("war", "extra", 40)];
  assert.deepEqual([...freeBackgrounds(backgrounds)], ["farm", "smith", "dice"]);
  const { total, lines } = creationCost({ backgrounds, societies: [{ id: "crown", name: "Crown", xpCost: 25 }] });
  assert.equal(total, 15 + 40 + 25);
  assert.equal(lines.find((l) => l.id === "farm").free, true);
});

test("XP over what the character has is refused", () => {
  const r = validateCreation({ ...complete, societies: [{ id: "crown", name: "Crown", xpCost: 50 }] }, { xpAvailable: 40 });
  assert.deepEqual(r.errors, [{ code: "needXP", cost: 50, have: 40 }]);
});

test("starting words: up to the setting, never base words", () => {
  const words = [{ id: "a", name: "Acrobatic" }, { id: "b", name: "Brutal" }];
  assert.deepEqual(codes(validateCreation({ ...complete, words }, { startingWords: 1 })), ["tooManyWords"]);
  assert.equal(validateCreation({ ...complete, words }, { startingWords: 2 }).valid, true);
  assert.deepEqual(codes(validateCreation({ ...complete, words: [{ id: "q", name: "Quick", baseWord: true }] }, { startingWords: 2 })), ["baseWordPicked"]);
  assert.deepEqual(codes(validateCreation({ ...complete, words }, { startingWords: 0 })), ["tooManyWords"]);
});

test("respec: free before creation, then spends points, a GM may waive", () => {
  assert.deepEqual(respecCheck({ created: false, points: 0, cost: 1 }), { ok: true, spend: 0 });
  assert.deepEqual(respecCheck({ created: true, points: 2, cost: 1 }), { ok: true, spend: 1 });
  assert.deepEqual(respecCheck({ created: true, points: 0, cost: 1 }), { ok: false, spend: 0, reason: "needPoints" });
  assert.equal(respecCheck({ created: true, points: 0, cost: 1, isGM: true }).ok, true);
  assert.equal(respecCheck({ created: true, points: 3, cost: 1, isGM: true, waive: true }).spend, 0);
  assert.equal(respecCheck({ created: true, points: 3, cost: 1, waive: true }).spend, 1); // players can't waive
});

test("advanced ancestry features: a talent that requires an ancestry", () => {
  const feature = { talentId: "starsight", name: "Starsight", domain: "mental", tier: 1, requiresAncestry: "elf", xpCost: 0 };
  const names = new Map([["elf", "Elf"]]);
  const locked = talentEligibility(feature, [], new Map(), { ancestries: ["dwarf"], ancestryNames: names });
  assert.equal(locked.eligible, false);
  assert.deepEqual(locked.reasons, [{ code: "needAncestry", id: "elf", name: "Elf" }]);
  assert.equal(talentEligibility(feature, [], new Map(), { ancestries: ["elf"] }).eligible, true);
  assert.deepEqual(validateTalentGraph([feature], { ancestryIds: ["dwarf"] }).map((i) => i.code), ["ancestryNotFound"]);
  assert.deepEqual(validateTalentGraph([feature], { ancestryIds: ["elf"] }), []);
});
