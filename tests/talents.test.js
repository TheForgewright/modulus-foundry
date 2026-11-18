// Test 12 (§17.2) and the talent graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { talentEligibility, validateTalentGraph, talentTree, talentSlug } from "../module/rules/talents.js";

const T = (talentId, domain, tier, o = {}) => ({ talentId, name: talentId.toUpperCase(), domain, tier, prereqTalent: "", crossPrereq: "", xpCost: 0, ...o });
const physical1 = (n) => Array.from({ length: n }, (_, i) => T(`p${i}`, "physical", 1));

test("test 12: tier 2 locked at 4 same-domain tier-1s, unlocked at 5 plus the named prerequisite (any domain)", () => {
  const prereq = T("s1", "social", 1);
  const t2 = T("tier2", "physical", 2, { prereqTalent: "s1" });
  const byId = new Map([[prereq.talentId, prereq]]);
  let r = talentEligibility(t2, [...physical1(4), prereq], byId);
  assert.equal(r.eligible, false);
  assert.deepEqual(r.reasons, [{ code: "needSameDomain", tier: 1, domain: "physical", have: 4, need: 5 }]);
  r = talentEligibility(t2, physical1(5), byId);
  assert.equal(r.eligible, false);
  assert.deepEqual(r.reasons.map((x) => x.code), ["needPrereq"]);
  assert.equal(r.reasons[0].name, "S1");
  assert.equal(talentEligibility(t2, [...physical1(5), prereq], byId).eligible, true);
});

test("the 5-count is per domain", () => {
  const owned = [...physical1(3), T("s1", "social", 1), T("s2", "social", 1)];
  const t2p = T("x", "physical", 2, { prereqTalent: "p0" });
  const t2s = T("y", "social", 2, { prereqTalent: "s1" });
  assert.equal(talentEligibility(t2p, owned).eligible, false);
  assert.equal(talentEligibility(t2s, owned).eligible, false);
});

test("test 12: tier 3 locked with 4 tier-2s; needs its tier-2 parent and the optional cross prerequisite", () => {
  const t2 = (i) => T(`q${i}`, "mental", 2, { prereqTalent: "m0" });
  const cross = T("c1", "social", 1);
  const t3 = T("top", "mental", 3, { prereqTalent: "q0", crossPrereq: "c1" });
  const four = [0, 1, 2, 3].map(t2);
  assert.deepEqual(talentEligibility(t3, [...four, cross]).reasons.map((r) => r.code), ["needSameDomain"]);
  const five = [...four, t2(4)];
  assert.deepEqual(talentEligibility(t3, five).reasons.map((r) => r.code), ["needCross"]);
  assert.equal(talentEligibility(t3, [...five, cross]).eligible, true);
  const noParent = five.filter((t) => t.talentId !== "q0").concat(t2(5));
  assert.deepEqual(talentEligibility(t3, [...noParent, cross]).reasons.map((r) => r.code), ["needPrereq"]);
});

test("tier 1 is open; owned talents are not eligible again; XP cost is checked", () => {
  const t1 = T("a", "physical", 1, { xpCost: 30 });
  assert.equal(talentEligibility(t1, [], new Map(), { xpAvailable: 40 }).eligible, true);
  const poor = talentEligibility(t1, [], new Map(), { xpAvailable: 20 });
  assert.equal(poor.eligible, false);
  assert.deepEqual(poor.reasons, [{ code: "needXP", cost: 30, have: 20 }]);
  const own = talentEligibility(t1, [t1], new Map(), { xpAvailable: 0 });
  assert.equal(own.owned, true);
  assert.equal(own.eligible, false);
  assert.deepEqual(own.reasons, []);
});

test("graph validation", () => {
  const talents = [
    T("a", "physical", 1), T("b", "physical", 1),
    T("c", "physical", 2, { prereqTalent: "a" }),
    T("d", "physical", 3, { prereqTalent: "c", crossPrereq: "a" }),   // cross is the parent's own tier-1
    T("e", "mental", 2, { prereqTalent: "c" }),                       // wrong tier
    T("f", "social", 2),                                              // no prereq
    T("g", "social", 3, { prereqTalent: "c", crossPrereq: "c" }),     // cross not tier 1
    T("a", "mental", 1)                                               // duplicate id
  ];
  const codes = validateTalentGraph(talents).map((i) => `${i.talentId}:${i.code}`);
  assert.ok(codes.includes("d:crossIsParentsOwn"));
  assert.ok(codes.includes("e:prereqWrongTier"));
  assert.ok(codes.includes("f:noPrereqSet"));
  assert.ok(codes.includes("g:crossWrongTier"));
  assert.ok(codes.includes("a:duplicateId"));
  assert.deepEqual(validateTalentGraph([T("a", "physical", 1), T("b", "physical", 2, { prereqTalent: "a" })]), []);
});

test("tree view and slugs", () => {
  const tree = talentTree([T("a", "physical", 1), T("c", "physical", 2, { prereqTalent: "a" }), T("d", "physical", 3, { prereqTalent: "c" }), T("z", "mental", 2, { prereqTalent: "gone" })]);
  assert.equal(tree.domains.physical[0].children[0].children[0].talentId, "d");
  assert.deepEqual(tree.loose.map((t) => t.talentId), ["z"]);
  assert.equal(talentSlug("Reads the Opening!"), "reads-the-opening");
  assert.equal(talentSlug("Élan"), "elan");
});
