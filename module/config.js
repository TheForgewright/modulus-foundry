/** System-wide constants for the Foundry layer. */
import { DOMAINS, EXPRESSIONS, TIERS, STAT_KEYS } from "./rules/constants.js";

export const SYSTEM_ID = "modulus";

export const MODULUS = {
  domains: Object.fromEntries(DOMAINS.map((d) => [d, `MODULUS.Domain.${d}`])),
  expressions: Object.fromEntries(EXPRESSIONS.map((e) => [e, `MODULUS.Expression.${e}`])),
  tiers: Object.fromEntries(TIERS.map((t) => [t, `MODULUS.Tier.${t}`])),
  /** Default display labels (§3.1). Cosmetic; designers may rename in lang files. */
  statLabels: Object.fromEntries(STAT_KEYS.map((k) => [k, `MODULUS.Stat.${k.replace(".", "_")}`])),
  defeatStatus: {
    physical: "MODULUS.Defeat.physical",
    mental: "MODULUS.Defeat.mental",
    social: "MODULUS.Defeat.social"
  },
  statusDurations: {
    untilNextTurn: "MODULUS.Status.Duration.untilNextTurn",
    rounds: "MODULUS.Status.Duration.rounds",
    scene: "MODULUS.Status.Duration.scene",
    encounter: "MODULUS.Status.Duration.encounter",
    persistent: "MODULUS.Status.Duration.persistent"
  }
};
