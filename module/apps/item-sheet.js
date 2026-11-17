/**
 * Generic item sheet. Renders scalar schema fields with Foundry's form helpers,
 * tags as a compact text field ("slow 2, offensive"), and effects as JSON until the
 * Phase 2 effects editor replaces it.
 */
import { SYSTEM_ID } from "../config.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const fields = foundry.data.fields;

export function formatTags(tags = []) {
  return tags.map((t) => (t.value ? `${t.name} ${t.value}` : t.name)).join(", ");
}

/** Parse "slow 2, offensive, armor penetrating 1" -> [{name, value}]. A trailing integer is the value. */
export function parseTags(text = "") {
  return String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s+(-?\d+)$/);
    return m ? { name: m[1].trim().toLowerCase(), value: Number(m[2]) } : { name: s.toLowerCase(), value: 0 };
  });
}

const STRING_LISTS = ["grantsWords", "grantsActions", "affectsTags", "wordPool", "defendsAgainst"];
const JSON_FIELDS = ["effects", "conditionalEffects"];

export class ModulusItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "sheet", "item"],
    position: { width: 560, height: 680 },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`, scrollable: [""] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const schema = item.system.schema;
    const scalar = [];
    const walk = (field, value) => {
      if (field instanceof fields.HTMLField) return;
      if (field instanceof fields.SchemaField) {
        for (const [k, f] of Object.entries(field.fields)) walk(f, value?.[k]);
        return;
      }
      if (field instanceof fields.ArrayField || field instanceof fields.ObjectField) return;
      scalar.push({ field, value });
    };
    for (const [k, f] of Object.entries(schema.fields)) walk(f, item.system._source[k]);

    const lists = STRING_LISTS.filter((k) => k in schema.fields).map((k) => ({
      key: k,
      label: game.i18n.localize(`MODULUS.Field.${k}`),
      value: item.system[k].join(", ")
    }));
    const json = JSON_FIELDS.filter((k) => k in schema.fields).map((k) => ({
      key: k,
      label: game.i18n.localize(`MODULUS.Field.${k}`),
      value: JSON.stringify(item.system._source[k], null, 2)
    }));

    Object.assign(context, {
      item,
      system: item.system,
      scalar,
      hasTags: "tags" in schema.fields,
      tagsText: "tags" in schema.fields ? formatTags(item.system.tags) : "",
      lists,
      json,
      descriptionHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description, { relativeTo: item }),
      descriptionField: schema.fields.description,
      isSkill: item.type === "skill"
    });
    return context;
  }

  /** Convert the text-encoded fields back into structured data before update. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = data.system ?? {};
    if (typeof sys._tagsText === "string") sys.tags = parseTags(sys._tagsText);
    delete sys._tagsText;
    for (const k of STRING_LISTS) {
      if (typeof sys[k] === "string") sys[k] = sys[k].split(",").map((s) => s.trim()).filter(Boolean);
    }
    for (const k of JSON_FIELDS) {
      if (typeof sys[k] !== "string") continue;
      try {
        const parsed = JSON.parse(sys[k] || "[]");
        if (!Array.isArray(parsed)) throw new Error("must be an array");
        sys[k] = parsed;
      } catch (err) {
        ui.notifications.error(game.i18n.format("MODULUS.Item.JSONError", { field: k, error: err.message }));
        delete sys[k];
      }
    }
    return data;
  }
}
