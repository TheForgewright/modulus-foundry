/**
 * Core vocabulary of the stat grid. Pure JS, no Foundry imports.
 */

export const DOMAINS = Object.freeze(["physical", "mental", "social"]);
export const EXPRESSIONS = Object.freeze(["power", "finesse", "resilience"]);

/** Tier names, indexed by rank: 0 = tertiary, 1 = secondary, 2 = primary. */
export const TIERS = Object.freeze(["tertiary", "secondary", "primary"]);

export const TIER_INDEX = Object.freeze({ tertiary: 0, secondary: 1, primary: 2 });

/** All nine stat keys, e.g. "physical.power". */
export const STAT_KEYS = Object.freeze(
  DOMAINS.flatMap((d) => EXPRESSIONS.map((e) => `${d}.${e}`))
);

export function statKey(domain, expression) {
  return `${domain}.${expression}`;
}

export function parseStatKey(key) {
  const [domain, expression] = String(key).split(".");
  if (!DOMAINS.includes(domain) || !EXPRESSIONS.includes(expression)) {
    throw new Error(`Invalid stat key: ${key}`);
  }
  return { domain, expression };
}

export function isStatKey(key) {
  return STAT_KEYS.includes(key);
}

/** Tier from dots (§3.2): 2 = primary, 1 = secondary, 0 = tertiary. */
export function tierFromDots(dots) {
  return TIERS[Math.max(0, Math.min(2, dots))];
}
