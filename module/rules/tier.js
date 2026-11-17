/**
 * Effective tier (§3.3, §8.1.4). Pure JS, no Foundry imports.
 *
 * Base tier, minus one step per defeated track, plus all active tier shifts,
 * summed before clamping. Steps below tertiary become debuff dice. Steps above
 * primary are clamped, or become buff dice when aboveRank = "buffDie" [OPEN #32].
 */

import { TIERS, TIER_INDEX } from "./constants.js";

/**
 * @param {object} p
 * @param {string|number} p.baseTier          "primary" | "secondary" | "tertiary" or 0..2
 * @param {number} [p.defeatedTracks=0]      count of defeated tracks
 * @param {number[]} [p.shifts=[]]            signed tier-shift deltas
 * @param {"clamp"|"buffDie"} [p.aboveRank="clamp"]
 * @returns {{tier: string, tierIndex: number, extraDebuffDice: number, extraBuffDice: number, steps: number}}
 */
export function effectiveTier({ baseTier, defeatedTracks = 0, shifts = [], aboveRank = "clamp" }) {
  const base = typeof baseTier === "number" ? baseTier : TIER_INDEX[baseTier];
  if (![0, 1, 2].includes(base)) throw new Error(`Invalid tier: ${baseTier}`);
  const steps = shifts.reduce((s, d) => s + d, 0) - defeatedTracks;
  let idx = base + steps;
  let extraDebuffDice = 0;
  let extraBuffDice = 0;
  if (idx < 0) {
    extraDebuffDice = -idx;
    idx = 0;
  } else if (idx > 2) {
    if (aboveRank === "buffDie") extraBuffDice = idx - 2;
    idx = 2;
  }
  return { tier: TIERS[idx], tierIndex: idx, extraDebuffDice, extraBuffDice, steps };
}

/** Defense DC from the defender's effective tier (§2.3). */
export function dcForTier(tier, table = { primary: 14, secondary: 11, tertiary: 8 }) {
  if (!(tier in table)) throw new Error(`Invalid tier: ${tier}`);
  return table[tier];
}
