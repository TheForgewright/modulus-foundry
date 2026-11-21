/**
 * Subject sheet (§7.11): name, picture, momentum settings, defense tiers and notes. A subject
 * has no HP tracks (OPEN #40); its encounter momentum is edited in the Encounter Manager.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS, EXPRESSIONS, TIERS, statKey } from "../rules/constants.js";
import { encountersOf } from "../encounter/lookup.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class SubjectSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "sheet", "actor", "subject"],
    position: { width: 520, height: 600 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      openEncounter: SubjectSheet.#onOpenEncounter
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/actor/subject.hbs`, scrollable: [""] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const t = (k) => game.i18n.localize(k);
    const tierOptions = Object.fromEntries(TIERS.map((x) => [x, t(`MODULUS.Tier.${x}`)]));
    return Object.assign(context, {
      actor,
      system: actor.system,
      source: actor.system._source,
      editable: this.isEditable,
      systemFields: actor.system.schema.fields,
      tiers: DOMAINS.map((d) => ({
        label: t(`MODULUS.Domain.${d}`),
        stats: EXPRESSIONS.map((e) => ({
          name: `system.directTiers.${d}.${e}`,
          label: t(`MODULUS.Stat.${statKey(d, e).replace(".", "_")}`),
          value: actor.system.directTiers[d][e]
        }))
      })),
      tierOptions,
      encounters: encountersOf(actor, { closed: true }).map(({ combat, combatant }) => ({
        combatId: combat.id, label: combat.label, kind: t(`MODULUS.Encounter.Kind.${combat.kind}`), momentum: combatant.momentum, closed: combat.closed
      })),
      biographyHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(actor.system.biography, { relativeTo: actor, secrets: actor.isOwner })
    });
  }

  static async #onOpenEncounter(event, target) {
    const { EncounterManager } = await import("./encounter-manager.js");
    EncounterManager.open(target.dataset.combatId);
  }
}
