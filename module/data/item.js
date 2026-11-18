/**
 * Item data models (§3, §6, §8, §9). Content is human-authored (§0.2.2);
 * these models only define the shape designers author into.
 */
import { DOMAINS } from "../rules/constants.js";
import {
  intField, statKeyField, domainField, tagsField, effectsField, groupsField, descriptionField, L
} from "./fields.js";

const fields = foundry.data.fields;
const bool = (initial, key) => new fields.BooleanField({ initial, label: L(key) });
const str = (key, opts = {}) => new fields.StringField({ required: true, blank: true, initial: "", label: L(key), ...opts });
const optInt = (key, opts = {}) => new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, label: L(key), ...opts });

class ModulusItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { description: descriptionField() };
  }
}

/** §6.1 Core action. */
export class ActionData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      rollStat: statKeyField({ label: L("rollStat") }),
      targetStat: statKeyField({ label: L("targetStat") }),
      momentumCost: intField(1, { label: L("momentumCost") }),
      rolls: bool(true, "rolls"),
      trained: bool(false, "trained"),
      tags: tagsField(),
      effects: effectsField(),
      groups: groupsField()
    };
  }
}

/** §6.2 Word: a delta object over an action. */
export class WordData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      momentumModifier: intField(0, { label: L("momentumModifier") }),
      trained: bool(false, "trained"),
      baseWord: bool(false, "baseWord"),
      tags: tagsField(),
      effects: effectsField(),
      groups: groupsField()
    };
  }
}

/** §8 Talent. */
export class TalentData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Stable key other talents point at as a prerequisite; survives copies and renames.
      talentId: str("talentId"),
      domain: domainField({ label: L("domain") }),
      tier: intField(1, { min: 1, max: 3, label: L("talentTier") }),
      prereqTalent: str("prereqTalent"),
      crossPrereq: str("crossPrereq"),
      xpCost: intField(0, { min: 0, label: L("xpCost") }),
      effects: effectsField(),
      conditionalEffects: effectsField("conditionalEffects"), // §8.1
      grantsWords: new fields.ArrayField(new fields.StringField(), { label: L("grantsWords") }),
      grantsActions: new fields.ArrayField(new fields.StringField(), { label: L("grantsActions") }),
      affectsTags: new fields.ArrayField(new fields.StringField(), { label: L("affectsTags") }),
      groups: groupsField()
    };
  }
}

/** §3.6 Skill. Rank r costs 10 x r XP; total for rank r is 10 x r(r+1)/2. */
export class SkillData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      rank: intField(0, { min: 0, label: L("rank") }),
      wordPool: new fields.ArrayField(new fields.StringField(), { label: L("wordPool") }),
      groups: groupsField()
    };
  }

  prepareDerivedData() {
    this.xpSpent = (10 * this.rank * (this.rank + 1)) / 2;
  }
}

/** §6.5 Status. */
export class StatusData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      duration: new fields.SchemaField({
        type: new fields.StringField({
          required: true, initial: "scene", label: L("duration.type"),
          choices: { untilNextTurn: "MODULUS.Status.Duration.untilNextTurn", rounds: "MODULUS.Status.Duration.rounds", scene: "MODULUS.Status.Duration.scene", encounter: "MODULUS.Status.Duration.encounter", persistent: "MODULUS.Status.Duration.persistent" }
        }),
        rounds: intField(1, { min: 0, label: L("duration.rounds") })
      }),
      track: new fields.StringField({
        required: true, initial: "all", label: L("track"),
        choices: { all: "MODULUS.Track.all", ...Object.fromEntries(DOMAINS.map((d) => [d, `MODULUS.Domain.${d}`])) }
      }),
      value: intField(0, { label: L("statusValue") }), // e.g. Exposed X
      tierDegrade: bool(false, "tierDegrade"),
      recovery: str("recovery"),
      context: str("context"),
      effects: effectsField(),
      groups: groupsField()
    };
  }
}

/** §3.7 Creation aspects. */
class AspectData extends ModulusItemData {
  static defineSchema() {
    return { ...super.defineSchema(), xpCost: intField(0, { min: 0, label: L("xpCost") }), effects: effectsField() };
  }
}

export class AncestryData extends AspectData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      advanced: bool(false, "advanced"),
      minorBoon: str("minorBoon"),
      majorBoon: str("majorBoon"),
      minorBane: str("minorBane")
    };
  }
}

export class SocietyData extends AspectData {}

export class BackgroundData extends AspectData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      category: new fields.StringField({
        required: true, initial: "childhood", label: L("category"),
        choices: { childhood: "MODULUS.Background.childhood", job: "MODULUS.Background.job", leisure: "MODULUS.Background.leisure", extra: "MODULUS.Background.extra" }
      })
    };
  }
}

/** §9 Armor [DRAFT]. Resistance contributes to the wearer's momentum resistance (wired up in Phase 6). */
export class ArmorData extends ModulusItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      equipped: bool(false, "equipped"),
      defendsAgainst: new fields.ArrayField(new fields.StringField(), { label: L("defendsAgainst") }),
      resistance: new fields.SchemaField(Object.fromEntries(DOMAINS.map((d) => [d, intField(0, { min: 0, label: `MODULUS.Domain.${d}` })]))),
      penalty: str("penalty"),
      tags: tagsField(),
      effects: effectsField()
    };
  }
}

export const ITEM_MODELS = {
  action: ActionData,
  word: WordData,
  talent: TalentData,
  skill: SkillData,
  status: StatusData,
  ancestry: AncestryData,
  society: SocietyData,
  background: BackgroundData,
  armor: ArmorData
};
