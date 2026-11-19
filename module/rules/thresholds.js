/**
 * XP thresholds (§3.5). Pure JS, no Foundry imports.
 *
 * There are no levels. A character's "threshold" is how many of the configured XP thresholds their
 * earned XP has reached (spent or banked, it all counts). Rules that used to read the level (track
 * pips and break points, the momentum ceiling, word slots) read this number instead.
 */

export const THRESHOLD_COUNT = 10;
export const DEFAULT_THRESHOLDS = Object.freeze([100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500]);

/** Clean thresholds: whole non-negative numbers; blanks and zeros are unused slots. Sorted ascending. */
export function normalizeThresholds(values = DEFAULT_THRESHOLDS) {
  return values
    .map((v) => Math.trunc(Number(v)))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
}

/**
 * @param {number} earned  XP earned (not XP left)
 * @returns {{threshold: number, next: number|null, previous: number, toNext: number|null}}
 *   threshold = how many thresholds are reached; next = XP needed for the next one (null at the top)
 */
export function thresholdFor(earned, values = DEFAULT_THRESHOLDS) {
  const list = normalizeThresholds(values);
  const xp = Math.max(0, Math.trunc(Number(earned) || 0));
  const threshold = list.filter((t) => xp >= t).length;
  const next = list[threshold] ?? null;
  return { threshold, next, previous: list[threshold - 1] ?? 0, toNext: next == null ? null : next - xp };
}
