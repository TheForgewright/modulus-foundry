/**
 * Talents (§8): eligibility, why a talent is locked, the prerequisite graph and XP. Pure JS.
 *
 * A talent here is plain data:
 *   { talentId, name, domain, tier, prereqTalent, crossPrereq, requires, xpCost }
 * Prerequisites point at another talent's `talentId` (a stable key that survives copies and renames).
 * `requires` lists further talents of any tier. A talent with several levels is a chain of separate
 * talents, each requiring the previous level.
 */

export const SAME_DOMAIN_REQUIRED = 5;

/** A stable key from a name: lower case, words joined by hyphens. */
export function talentSlug(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "talent";
}

const count = (owned, tier, domain) => owned.filter((t) => t.tier === tier && t.domain === domain).length;
const has = (owned, id) => Boolean(id) && owned.some((t) => t.talentId === id);

/**
 * Can a character take this talent?
 * @param {object} talent
 * @param {object[]} owned          the character's talents
 * @param {Map<string, object>} byId  every known talent, for prerequisite names
 * @param {{xpAvailable?: number}} [opts]
 * @returns {{eligible: boolean, owned: boolean, affordable: boolean, cost: number, reasons: object[]}}
 *   reasons are codes with data, e.g. { code: "needSameDomain", tier: 1, domain, have: 4, need: 5 }
 */
export function talentEligibility(talent, owned, byId = new Map(), { xpAvailable = Infinity } = {}) {
  const reasons = [];
  const cost = Math.max(0, Math.trunc(talent.xpCost ?? 0));
  const isOwned = has(owned, talent.talentId);
  const name = (id) => byId.get(id)?.name ?? id;
  if (talent.tier === 2 || talent.tier === 3) {
    const below = talent.tier - 1;
    const have = count(owned, below, talent.domain);
    if (have < SAME_DOMAIN_REQUIRED) {
      reasons.push({ code: "needSameDomain", tier: below, domain: talent.domain, have, need: SAME_DOMAIN_REQUIRED });
    }
    if (!talent.prereqTalent) reasons.push({ code: "noPrereqSet", tier: below });
    else if (!has(owned, talent.prereqTalent)) reasons.push({ code: "needPrereq", id: talent.prereqTalent, name: name(talent.prereqTalent), tier: below });
    if (talent.tier === 3 && talent.crossPrereq && !has(owned, talent.crossPrereq)) {
      reasons.push({ code: "needCross", id: talent.crossPrereq, name: name(talent.crossPrereq) });
    }
  }
  for (const id of talent.requires ?? []) {
    if (id && !has(owned, id)) reasons.push({ code: "needRequired", id, name: name(id) });
  }
  const affordable = cost <= xpAvailable;
  if (!isOwned && !affordable) reasons.push({ code: "needXP", cost, have: xpAvailable });
  return { eligible: !isOwned && reasons.length === 0, owned: isOwned, affordable, cost, reasons };
}

/**
 * What a character's talents grant (§3.6: with skills gone, words come from talents).
 * Talents list granted words and actions by name or vocabulary id; matching ignores case.
 * @param {Array<{grantsWords?: string[], grantsActions?: string[]}>} talents
 * @returns {{words: Set<string>, actions: Set<string>}} lower-cased keys
 */
export function talentGrants(talents) {
  const words = new Set();
  const actions = new Set();
  for (const t of talents) {
    for (const w of t.grantsWords ?? []) if (String(w).trim()) words.add(String(w).trim().toLowerCase());
    for (const a of t.grantsActions ?? []) if (String(a).trim()) actions.add(String(a).trim().toLowerCase());
  }
  return { words, actions };
}

/** Is a word or action ({name, vocabId}) in a grant set? */
export function isGranted(entry, grants) {
  return grants.has(String(entry.name ?? "").toLowerCase()) || (entry.vocabId != null && grants.has(String(entry.vocabId).toLowerCase()));
}

/**
 * Check the authored graph (§8, §15 talent editor).
 * @returns {Array<{talentId, code, ...}>} problems; empty when valid
 */
export function validateTalentGraph(talents) {
  const issues = [];
  const byId = new Map();
  for (const t of talents) {
    if (!t.talentId) issues.push({ talentId: "", name: t.name, code: "noId" });
    else if (byId.has(t.talentId)) issues.push({ talentId: t.talentId, name: t.name, code: "duplicateId" });
    else byId.set(t.talentId, t);
  }
  for (const t of talents) {
    const issue = (code, data = {}) => issues.push({ talentId: t.talentId, name: t.name, code, ...data });
    if (![1, 2, 3].includes(t.tier)) issue("badTier");
    if (!["physical", "mental", "social"].includes(t.domain)) issue("noDomain");
    for (const id of t.requires ?? []) {
      if (id === t.talentId) issue("requiresSelf");
      else if (!byId.has(id)) issue("requiredNotFound", { id });
    }
    if (t.tier === 1) {
      if (t.prereqTalent) issue("tier1HasPrereq");
      if (t.crossPrereq) issue("crossOnlyTier3");
      continue;
    }
    const parent = byId.get(t.prereqTalent);
    if (!t.prereqTalent) issue("noPrereqSet", { tier: t.tier - 1 });
    else if (!parent) issue("prereqNotFound", { id: t.prereqTalent });
    else if (parent.tier !== t.tier - 1) issue("prereqWrongTier", { id: t.prereqTalent, tier: parent.tier, need: t.tier - 1 });
    if (t.tier === 2 && t.crossPrereq) issue("crossOnlyTier3");
    if (t.tier === 3 && t.crossPrereq) {
      const cross = byId.get(t.crossPrereq);
      if (!cross) issue("crossNotFound", { id: t.crossPrereq });
      else if (cross.tier !== 1) issue("crossWrongTier", { id: t.crossPrereq, tier: cross.tier });
      else if (parent && cross.talentId === parent.prereqTalent) issue("crossIsParentsOwn", { id: t.crossPrereq });
    }
  }
  // Loops through any prerequisite (a talent that ends up needing itself) can never be taken.
  for (const id of findCycles(talents)) {
    const t = byId.get(id);
    issues.push({ talentId: id, name: t?.name, code: "cycle" });
  }
  return issues;
}

/** Talent ids that sit on a prerequisite loop. */
export function findCycles(talents) {
  const edges = new Map(talents.map((t) => [t.talentId, [t.prereqTalent, t.crossPrereq, ...(t.requires ?? [])].filter(Boolean)]));
  const state = new Map(); // 1 = visiting, 2 = done
  const onCycle = new Set();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2 || !edges.has(id)) return;
    if (state.get(id) === 1) {
      for (const x of stack.slice(stack.indexOf(id))) onCycle.add(x);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id)) visit(next);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of edges.keys()) visit(id);
  return [...onCycle];
}

/**
 * The graph as trees, for the read-only view: per domain, tier-1 talents with their tier-2
 * children and their tier-3 children. Tier 2/3 talents whose prerequisite is in another domain
 * appear under their own domain with `parentDomain` set.
 */
export function talentTree(talents) {
  const domains = { physical: [], mental: [], social: [] };
  const byId = new Map(talents.map((t) => [t.talentId, t]));
  const childrenOf = (id, tier) => talents.filter((t) => t.tier === tier && t.prereqTalent === id);
  const node = (t) => ({
    ...t,
    cross: t.crossPrereq ? byId.get(t.crossPrereq) ?? { talentId: t.crossPrereq, name: t.crossPrereq, missing: true } : null,
    required: (t.requires ?? []).map((id) => byId.get(id) ?? { talentId: id, name: id, missing: true }),
    children: t.tier < 3 ? childrenOf(t.talentId, t.tier + 1).map(node) : []
  });
  for (const t of talents.filter((x) => x.tier === 1)) (domains[t.domain] ?? []).push(node(t));
  const loose = talents.filter((t) => t.tier > 1 && !byId.has(t.prereqTalent));
  return { domains, loose };
}
