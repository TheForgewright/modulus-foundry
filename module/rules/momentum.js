/**
 * Momentum helpers (§5). Pure JS, no Foundry imports.
 */

import { evaluateFormula } from "./formula.js";

/** Ceiling (§5.1): formula setting, default "5 + level". */
export function momentumCeiling(level, formula = "5 + level") {
  return evaluateFormula(formula, { level });
}

/** Round gain (§5.2) [DRAFT]: current = min(ceiling, current + gain). Never lowers a value already above ceiling. */
export function gainMomentum({ current, gain, ceiling }) {
  if (current >= ceiling) return current;
  return Math.min(ceiling, current + gain);
}
