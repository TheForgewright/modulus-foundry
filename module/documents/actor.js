import { DOMAINS, parseStatKey } from "../rules/constants.js";
import { effectiveTier, dcForTier } from "../rules/tier.js";
import { applyPips, shortRest, longRest } from "../rules/tracks.js";
import { dcTable, getSetting } from "../settings.js";

export class ModulusActor extends Actor {
  /** Base tier of a stat, before degradation and shifts. */
  getBaseTier(key) {
    const { domain, expression } = parseStatKey(key);
    return this.system.stats[domain][expression].tier;
  }

  /**
   * §3.3 effective tier, shared by rolling and defense.
   * Conditional-effect tier shifts (§8.1) are added in Phase 4.
   * @param {string} key
   * @param {{defense?: boolean, shifts?: number[]}} [opts]
   */
  getEffectiveTier(key, { defense = false, shifts = [] } = {}) {
    const defeatedTracks = defense && !getSetting("defeatAffectsDefense") ? 0 : this.system.defeatedTracks;
    const result = effectiveTier({
      baseTier: this.getBaseTier(key),
      defeatedTracks,
      shifts,
      aboveRank: getSetting("condFx.aboveRank")
    });
    result.baseTier = this.getBaseTier(key);
    result.defeatedTracks = defeatedTracks;
    return result;
  }

  /** Defense DC when this actor is the target of an action testing `key` (§2.3). */
  getDefenseDC(key) {
    const eff = this.getEffectiveTier(key, { defense: true });
    return { dc: dcForTier(eff.tier, dcTable()), ...eff };
  }

  /**
   * Apply damage (positive) or healing (negative) to one track.
   * Overflow (§4.4) is reported, not auto-spent: the player chooses where it goes.
   */
  async applyPips(domain, amount) {
    const track = this.system.tracks[domain];
    const r = applyPips({ pipsLost: track.pipsLost, amount, max: track.max, perLevel: track.perLevel });
    const update = { [`system.tracks.${domain}.pipsLost`]: r.pipsLost };
    // A fresh change to the track re-arms the defeat status.
    if (r.pipsLost !== track.pipsLost) update[`system.tracks.${domain}.defeatCleared`] = false;
    await this.update(update);
    if (r.overflow > 0) {
      ui.notifications.info(game.i18n.format("MODULUS.Tracks.Overflow", { name: this.name, amount: r.overflow, track: game.i18n.localize(`MODULUS.Domain.${domain}`) }));
    }
    if (r.breakPointsCrossed > 0) {
      ui.notifications.info(game.i18n.format("MODULUS.Tracks.BreakPoint", { name: this.name, track: game.i18n.localize(`MODULUS.Domain.${domain}`) }));
    }
    return r;
  }

  async rest(kind) {
    const fn = kind === "long" ? longRest : shortRest;
    const update = {};
    for (const d of DOMAINS) {
      const t = this.system.tracks[d];
      const next = fn(t.pipsLost, t.perLevel);
      if (next !== t.pipsLost) {
        update[`system.tracks.${d}.pipsLost`] = next;
        update[`system.tracks.${d}.defeatCleared`] = false;
      }
    }
    if (Object.keys(update).length) await this.update(update);
  }

  async clearDefeat(domain) {
    await this.update({ [`system.tracks.${domain}.defeatCleared`]: true });
  }
}
