/**
 * Dot allocation (§3.2). Pure JS, no Foundry imports.
 *
 * Store only { domain, expression, freeDot } and derive everything else.
 */

import { DOMAINS, EXPRESSIONS, STAT_KEYS, TIERS, parseStatKey, statKey, tierFromDots } from "./constants.js";

/**
 * Validate an allocation.
 * @returns {{valid: boolean, errors: string[], complete: boolean}}
 *   `errors` are i18n-friendly codes. `complete` is false while choices are still blank.
 */
export function validateAllocation({ domain, expression, freeDot } = {}) {
  const errors = [];
  if (!domain) errors.push("MODULUS.Allocation.Error.NoDomain");
  else if (!DOMAINS.includes(domain)) errors.push("MODULUS.Allocation.Error.BadDomain");
  if (!expression) errors.push("MODULUS.Allocation.Error.NoExpression");
  else if (!EXPRESSIONS.includes(expression)) errors.push("MODULUS.Allocation.Error.BadExpression");
  if (!freeDot) errors.push("MODULUS.Allocation.Error.NoFreeDot");
  else if (!STAT_KEYS.includes(freeDot)) errors.push("MODULUS.Allocation.Error.BadFreeDot");
  else if (domain && expression && freeDot === statKey(domain, expression)) {
    errors.push("MODULUS.Allocation.Error.FreeDotOnIntersection");
  }
  return { valid: errors.length === 0, errors, complete: Boolean(domain && expression && freeDot) };
}

/**
 * Compute dots for every stat. Applies whatever part of the allocation is valid,
 * so a half-finished allocation still renders sensibly on the sheet.
 * @returns {Record<string, number>} stat key -> dots (0..2)
 */
export function computeDots({ domain, expression, freeDot } = {}) {
  const dots = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  const hasD = DOMAINS.includes(domain);
  const hasE = EXPRESSIONS.includes(expression);
  for (const key of STAT_KEYS) {
    const { domain: d, expression: e } = parseStatKey(key);
    if (hasD && hasE && d === domain && e === expression) dots[key] = 2;
    else if ((hasD && d === domain) || (hasE && e === expression)) dots[key] = 1;
  }
  const intersection = hasD && hasE ? statKey(domain, expression) : null;
  if (STAT_KEYS.includes(freeDot) && freeDot !== intersection) {
    dots[freeDot] = Math.min(2, dots[freeDot] + 1);
  }
  return dots;
}

/** Stat key -> tier name. */
export function computeTiers(allocation) {
  const dots = computeDots(allocation);
  return Object.fromEntries(Object.entries(dots).map(([k, v]) => [k, tierFromDots(v)]));
}

/** Count of primary / secondary / tertiary stats. */
export function shapeSummary(allocation) {
  const tiers = computeTiers(allocation);
  const out = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const t of Object.values(tiers)) out[t]++;
  return out;
}
