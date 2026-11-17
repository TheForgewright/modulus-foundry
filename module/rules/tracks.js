/**
 * HP tracks, pips and break points (§4). Pure JS, no Foundry imports.
 *
 * A track is a row of pips grouped into one segment per level. Pips are lost
 * in order; the last pip lost in each segment is that segment's break point.
 * State is a single integer `pipsLost`.
 */

import { TIER_INDEX } from "./constants.js";

export const DEFAULT_PIPS_PER_LEVEL = Object.freeze({ primary: 4, secondary: 3, tertiary: 2 });

export function pipsPerLevel(tier, table = DEFAULT_PIPS_PER_LEVEL) {
  if (!(tier in TIER_INDEX)) throw new Error(`Invalid tier: ${tier}`);
  return table[tier];
}

/** Level used for pip math. [OPEN] level 0: treated as `minLevel` (default 1). */
export function pipLevel(level, minLevel = 1) {
  return Math.max(Math.floor(level) || 0, minLevel);
}

export function trackMax({ tier, level, table = DEFAULT_PIPS_PER_LEVEL, minLevel = 1 }) {
  return pipsPerLevel(tier, table) * pipLevel(level, minLevel);
}

export function clampLost(pipsLost, max) {
  return Math.max(0, Math.min(max, Math.floor(pipsLost) || 0));
}

/**
 * Full view of a track for rendering and rules.
 * @returns {{max, perLevel, lost, remaining, depleted, breakPointsReached, segments: Array<{index, pips: Array<{index, lost, breakPoint}>, broken}>}}
 */
export function describeTrack({ tier, level, pipsLost, table = DEFAULT_PIPS_PER_LEVEL, minLevel = 1 }) {
  const perLevel = pipsPerLevel(tier, table);
  const max = trackMax({ tier, level, table, minLevel });
  const lost = clampLost(pipsLost, max);
  const segments = [];
  for (let s = 0; s < max / perLevel; s++) {
    const pips = [];
    for (let p = 0; p < perLevel; p++) {
      const index = s * perLevel + p;
      pips.push({ index, lost: index < lost, breakPoint: p === perLevel - 1 });
    }
    segments.push({ index: s, pips, broken: lost >= (s + 1) * perLevel });
  }
  return {
    max,
    perLevel,
    lost,
    remaining: max - lost,
    depleted: lost >= max,
    breakPointsReached: breakPointsReached(lost, perLevel),
    segments
  };
}

export function breakPointsReached(pipsLost, perLevel) {
  return Math.floor(pipsLost / perLevel);
}

/** Number of new break points reached when going from `before` to `after` pips lost. */
export function breakPointsCrossed(before, after, perLevel) {
  return Math.max(0, breakPointsReached(after, perLevel) - breakPointsReached(before, perLevel));
}

/**
 * Short rest (§4.3): restore all lost pips in the current segment unless its break point was reached.
 * @returns {number} new pipsLost
 */
export function shortRest(pipsLost, perLevel) {
  return pipsLost - (pipsLost % perLevel);
}

/**
 * Long rest (§4.3): restore one level's segment worth of pips.
 * [OPEN #22] exact structure; this restores `perLevel` pips from the most recent loss.
 * @returns {number} new pipsLost
 */
export function longRest(pipsLost, perLevel) {
  return Math.max(0, pipsLost - perLevel);
}

/**
 * Apply damage (positive) or healing (negative) to a single track, clamped.
 * Overflow into other tracks (§4.4) is the player's choice and handled by the caller.
 * @returns {{pipsLost:number, overflow:number, breakPointsCrossed:number, depleted:boolean}}
 */
export function applyPips({ pipsLost, amount, max, perLevel }) {
  const raw = pipsLost + amount;
  const next = clampLost(raw, max);
  return {
    pipsLost: next,
    overflow: Math.max(0, raw - max),
    breakPointsCrossed: breakPointsCrossed(pipsLost, next, perLevel),
    depleted: next >= max
  };
}
