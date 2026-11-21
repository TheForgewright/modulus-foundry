/**
 * Character creation (§3.2, §3.7) and respec (§3.4). Pure JS, no Foundry imports.
 *
 * A creation plan is plain data:
 *   { allocation: {domain, expression, freeDot},
 *     ancestry: {id, name} | null,
 *     societies: [{id, name, xpCost}],
 *     backgrounds: [{id, name, category, xpCost}],
 *     words: [{id, name, baseWord}] }
 *
 * Ancestries cost no XP (advanced ancestry features are talents, §3.7). Societies cost their own XP.
 * One Childhood, one Job and one Leisure background are required and free; every further background
 * costs its XP. The number of starting words is a setting.
 */
import { validateAllocation } from "./allocation.js";

export const REQUIRED_BACKGROUNDS = ["childhood", "job", "leisure"];

const xp = (n) => Math.max(0, Math.trunc(Number(n) || 0));

/**
 * Which backgrounds are free: the first one picked in each required category.
 * @returns {Set<string>} ids of the free backgrounds
 */
export function freeBackgrounds(backgrounds = []) {
  const free = new Set();
  for (const cat of REQUIRED_BACKGROUNDS) {
    const first = backgrounds.find((b) => b.category === cat);
    if (first) free.add(first.id);
  }
  return free;
}

/**
 * XP the plan costs, itemised.
 * @returns {{total: number, lines: Array<{kind, id, name, cost, free?: boolean}>}}
 */
export function creationCost(plan = {}) {
  const lines = [];
  for (const s of plan.societies ?? []) lines.push({ kind: "society", id: s.id, name: s.name, cost: xp(s.xpCost) });
  const free = freeBackgrounds(plan.backgrounds);
  for (const b of plan.backgrounds ?? []) {
    const isFree = free.has(b.id);
    lines.push({ kind: "background", id: b.id, name: b.name, cost: isFree ? 0 : xp(b.xpCost), free: isFree });
  }
  return { total: lines.reduce((n, l) => n + l.cost, 0), lines };
}

/**
 * Check a plan.
 * @param {object} plan
 * @param {object} opts
 * @param {number} opts.startingWords      how many words may be picked (setting)
 * @param {number} [opts.xpAvailable]      XP the character has to spend
 * @param {boolean} [opts.ancestriesExist] an ancestry is only required when there is one to pick
 * @param {string[]} [opts.backgroundCategories] required categories that have content to pick from
 * @returns {{valid: boolean, errors: object[], cost: number, lines: object[]}}
 *   errors are codes with data, e.g. { code: "needBackground", category: "job" }
 */
export function validateCreation(plan = {}, { startingWords = 0, xpAvailable = Infinity, ancestriesExist = true, backgroundCategories = REQUIRED_BACKGROUNDS } = {}) {
  const errors = [];
  const alloc = validateAllocation(plan.allocation ?? {});
  for (const key of alloc.errors) errors.push({ code: "allocation", key });
  if (ancestriesExist && !plan.ancestry) errors.push({ code: "needAncestry" });
  const backgrounds = plan.backgrounds ?? [];
  for (const category of REQUIRED_BACKGROUNDS) {
    if (backgroundCategories.includes(category) && !backgrounds.some((b) => b.category === category)) errors.push({ code: "needBackground", category });
  }
  const words = plan.words ?? [];
  const max = Math.max(0, Math.trunc(startingWords));
  if (words.length > max) errors.push({ code: "tooManyWords", have: words.length, max });
  const base = words.filter((w) => w.baseWord);
  if (base.length) errors.push({ code: "baseWordPicked", names: base.map((w) => w.name).join(", ") });
  const ids = [...(plan.societies ?? []), ...backgrounds, ...words].map((x) => x.id);
  if (new Set(ids).size !== ids.length) errors.push({ code: "duplicate" });
  const { total, lines } = creationCost(plan);
  if (total > xpAvailable) errors.push({ code: "needXP", cost: total, have: xpAvailable });
  return { valid: errors.length === 0, errors, cost: total, lines };
}

/**
 * Can this character re-run their dot allocation (§3.4)?
 * Before creation is finished it is free. Afterwards it spends respec points; a GM may waive them.
 * @param {{created: boolean, points: number, cost: number, isGM?: boolean, waive?: boolean}} o
 * @returns {{ok: boolean, spend: number, reason?: string}}
 */
export function respecCheck({ created, points, cost, isGM = false, waive = false }) {
  if (!created) return { ok: true, spend: 0 };
  const need = xp(cost);
  if (isGM && waive) return { ok: true, spend: 0, reason: "gmWaived" };
  if (xp(points) >= need) return { ok: true, spend: need };
  if (isGM) return { ok: true, spend: 0, reason: "gmWaived" };
  return { ok: false, spend: 0, reason: "needPoints" };
}
