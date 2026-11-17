/**
 * Roll engine (§2.1, §2.2, §13). Pure JS, no Foundry imports.
 *
 * Roll 3 + B + D d20, sort ascending, drop the B lowest and D highest,
 * then keep the low / middle / high die of the remaining three by tier.
 */

import { TIER_INDEX } from "./constants.js";

function assertCounts(buff, debuff) {
  if (!Number.isInteger(buff) || buff < 0) throw new Error(`Invalid buff dice: ${buff}`);
  if (!Number.isInteger(debuff) || debuff < 0) throw new Error(`Invalid debuff dice: ${debuff}`);
}

function tierIdx(tier) {
  const idx = typeof tier === "number" ? tier : TIER_INDEX[tier];
  if (![0, 1, 2].includes(idx)) throw new Error(`Invalid tier: ${tier}`);
  return idx;
}

/** Number of d20 rolled for the given buff / debuff dice. */
export function diceCount(buff = 0, debuff = 0) {
  assertCounts(buff, debuff);
  return 3 + buff + debuff;
}

/**
 * Select the kept die from already-rolled faces.
 * Used by the Foundry layer, which rolls the dice through `Roll` so animations play.
 * @param {number[]} faces  Raw faces in roll order. Length must be 3 + buff + debuff.
 * @returns {{faces:number[], sorted:number[], kept3:number[], kept:number, keptIndex:number, droppedIndices:number[]}}
 *   `keptIndex` is the index of the kept die in `faces`; `droppedIndices` are the indices of all other dice.
 */
export function keepFromFaces(faces, { tier, buff = 0, debuff = 0 }) {
  const n = diceCount(buff, debuff);
  if (faces.length !== n) throw new Error(`Expected ${n} faces, got ${faces.length}`);
  const order = faces.map((f, i) => i).sort((a, b) => faces[a] - faces[b] || a - b);
  const sorted = order.map((i) => faces[i]);
  const kept3 = sorted.slice(buff, n - debuff);
  const idx = tierIdx(tier);
  const keptIndex = order[buff + idx];
  const droppedIndices = order.filter((i) => i !== keptIndex).sort((a, b) => a - b);
  return { faces: [...faces], sorted, kept3, kept: kept3[idx], keptIndex, droppedIndices };
}

/**
 * Roll and keep with an injectable RNG (returns [0, 1)).
 */
export function rollKept({ tier, buff = 0, debuff = 0, rng = Math.random }) {
  const n = diceCount(buff, debuff);
  const faces = Array.from({ length: n }, () => 1 + Math.floor(rng() * 20));
  return keepFromFaces(faces, { tier, buff, debuff });
}

/* -------------------------------------------- */
/*  Exact distributions                          */
/* -------------------------------------------- */

const distCache = new Map();

/**
 * Exact probability distribution of the kept die, by order statistics.
 * P(k-th smallest of n iid d20 <= v) = sum_{j=k..n} C(n,j) p^j (1-p)^(n-j), p = v/20.
 * Exact up to floating point; validated against brute-force enumeration in tests.
 * @returns {number[]} array of length 21; index v holds P(kept = v), index 0 unused (0).
 */
export function keptDistribution({ tier, buff = 0, debuff = 0 }) {
  const n = diceCount(buff, debuff);
  const k = buff + tierIdx(tier) + 1; // 1-based order statistic
  const key = `${n}:${k}`;
  if (distCache.has(key)) return distCache.get(key);
  const cdf = (v) => {
    const p = v / 20;
    let s = 0;
    for (let j = k; j <= n; j++) s += binom(n, j) * p ** j * (1 - p) ** (n - j);
    return s;
  };
  const dist = [0];
  for (let v = 1; v <= 20; v++) dist.push(cdf(v) - cdf(v - 1));
  distCache.set(key, dist);
  return dist;
}

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Expected value of the kept die. */
export function expectedKept(opts) {
  return keptDistribution(opts).reduce((s, p, v) => s + p * v, 0);
}

/** Probability that kept + flatBonus >= dc. */
export function hitChance({ tier, buff = 0, debuff = 0, dc, flatBonus = 0 }) {
  const dist = keptDistribution({ tier, buff, debuff });
  let s = 0;
  for (let v = 1; v <= 20; v++) if (v + flatBonus >= dc) s += dist[v];
  return s;
}

/** Meet-or-beat (§2.1). No crits, no fumbles. */
export function isHit(total, dc) {
  return total >= dc;
}
