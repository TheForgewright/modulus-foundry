/**
 * Actor data models (§12). Derived values are computed in prepareDerivedData
 * by calling the pure rules engine; only allocation choices and raw state are stored.
 */
import { DOMAINS, EXPRESSIONS, STAT_KEYS, TIERS, statKey } from "../rules/constants.js";
import { computeDots, validateAllocation, shapeSummary } from "../rules/allocation.js";
import { tierFromDots } from "../rules/constants.js";
import { describeTrack } from "../rules/tracks.js";
import { getFormula, getSetting, pipsTable, xpThresholds } from "../settings.js";
import { thresholdFor } from "../rules/thresholds.js";
import { intField, tierField, L } from "./fields.js";

const fields = foundry.data.fields;

function statsSchema() {
  return new fields.SchemaField(Object.fromEntries(DOMAINS.map((d) => [d, new fields.SchemaField(
    Object.fromEntries(EXPRESSIONS.map((e) => [e, new fields.SchemaField({
      // §2.5 v0.1 placeholder; hidden behind the "advanced" setting. Do not build on it.
      bonus: intField(0, { label: L("bonus") })
    })]))
  )])));
}

function tracksSchema(npc = false) {
  return new fields.SchemaField(Object.fromEntries(DOMAINS.map((d) => [d, new fields.SchemaField({
    pipsLost: intField(0, { min: 0 }),
    // GM one-click clear of the defeat status (§4.5) while the track is still empty.
    defeatCleared: new fields.BooleanField({ initial: false }),
    ...(npc ? { maxOverride: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }) } : {})
  })])));
}

export class ModulusActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      xp: new fields.SchemaField({
        // XP earned. Spent or banked, it all counts toward thresholds (§3.5).
        total: intField(100, { min: 0, label: L("xp.total") }),
        spent: intField(0, { min: 0, label: L("xp.spent") })
      }),
      allocation: new fields.SchemaField({
        domain: new fields.StringField({ required: true, blank: true, initial: "" }),
        expression: new fields.StringField({ required: true, blank: true, initial: "" }),
        freeDot: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      stats: statsSchema(),
      tracks: tracksSchema(this.isNPC),
      momentum: new fields.SchemaField({
        starting: intField(3, { label: L("momentum.starting") }),
        gainPerTurn: intField(1, { label: L("momentum.gainPerTurn") }),
        current: intField(3, { label: L("momentum.current") }),
        resistance: new fields.SchemaField(Object.fromEntries(DOMAINS.map((d) => [d, intField(0, { min: 0 })])))
      }),
      respecPoints: intField(0, { min: 0, label: L("respecPoints") }),
      biography: new fields.HTMLField({ required: true, blank: true, initial: "" })
    };
  }

  static isNPC = false;

  /** Base tiers before degradation. Overridden by NPC direct mode. */
  _baseTiers() {
    const dots = computeDots(this.allocation);
    return { dots, tiers: Object.fromEntries(STAT_KEYS.map((k) => [k, tierFromDots(dots[k])])) };
  }

  prepareDerivedData() {
    // No levels: the threshold reached by earned XP stands in wherever the rules used the level.
    const t = thresholdFor(this.xp.total, xpThresholds());
    this.threshold = t.threshold;
    this.nextThreshold = t.next;
    this.toNextThreshold = t.toNext;
    this.xp.available = this.xp.total - this.xp.spent;
    this.level = t.threshold;
    const { dots, tiers } = this._baseTiers();
    this.allocationStatus = validateAllocation(this.allocation);
    this.shape = Object.fromEntries(TIERS.map((t) => [t, 0]));
    for (const d of DOMAINS) {
      for (const e of EXPRESSIONS) {
        const key = statKey(d, e);
        const stat = this.stats[d][e];
        stat.key = key;
        stat.dots = dots[key];
        stat.tier = tiers[key];
        this.shape[stat.tier]++;
      }
    }

    // Tracks (§4.2): tier of that domain's Resilience stat.
    const table = pipsTable();
    const minLevel = getSetting("pips.minLevel");
    let defeated = 0;
    for (const d of DOMAINS) {
      const track = this.tracks[d];
      const tier = this.stats[d].resilience.tier;
      const view = describeTrack({ tier, level: this.level, pipsLost: track.pipsLost, table, minLevel });
      if (track.maxOverride != null) {
        // NPC override: one segment holding all pips.
        Object.assign(view, describeTrack({ tier, level: 1, pipsLost: track.pipsLost, table: { ...table, [tier]: Math.max(1, track.maxOverride) }, minLevel: 1 }));
      }
      Object.assign(track, view, { tier, domain: d });
      track.defeated = track.depleted && track.max > 0 && !track.defeatCleared;
      if (track.defeated) defeated++;
    }
    this.defeatedTracks = defeated;
    this.allDepleted = DOMAINS.every((d) => this.tracks[d].depleted);

    this.momentum.ceiling = getFormula("momentum.ceiling", { level: this.level });
    this.maxWords = getFormula("maxWordsFormula", { level: this.level });
  }
}

export class CharacterData extends ModulusActorData {}

export class NPCData extends ModulusActorData {
  static isNPC = true;

  static defineSchema() {
    return {
      ...super.defineSchema(),
      // §12: GMs may set tiers directly instead of using dots.
      statsMode: new fields.StringField({ required: true, initial: "dots", choices: { dots: "MODULUS.NPC.StatsMode.dots", direct: "MODULUS.NPC.StatsMode.direct" } }),
      directTiers: new fields.SchemaField(Object.fromEntries(DOMAINS.map((d) => [d, new fields.SchemaField(
        Object.fromEntries(EXPRESSIONS.map((e) => [e, tierField()]))
      )])))
    };
  }

  _baseTiers() {
    if (this.statsMode !== "direct") return super._baseTiers();
    const tiers = {};
    const dots = {};
    for (const k of STAT_KEYS) {
      const [d, e] = k.split(".");
      tiers[k] = this.directTiers[d][e];
      dots[k] = TIERS.indexOf(tiers[k]);
    }
    return { dots, tiers };
  }
}
