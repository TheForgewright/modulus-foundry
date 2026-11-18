/**
 * Item sheet. Scalar schema fields render with Foundry's form helpers; tags get a
 * chip editor with registry autocomplete; effects get a typed row editor driven by
 * the rules/effects.js catalog. Card-deck ops keep a JSON editor for their args.
 */
import { SYSTEM_ID } from "../config.js";
import { STAT_KEYS, isStatKey } from "../rules/constants.js";
import { EFFECT_OPS, EFFECT_TRIGGERS, EFFECT_TARGETS, coerceEffect, validateEffect, describeEffect, newEffect, defaultArgs } from "../rules/effects.js";
import { normalizeTag } from "../rules/tags.js";
import { tagRegistry } from "../settings.js";
import { editorRows, recordsFromForm, newRecord } from "../talents/condfx-editor.js";
import { knownTalents, talentData, issueText } from "../talents/talents.js";
import { validateTalentGraph } from "../rules/talents.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const fields = foundry.data.fields;

const STRING_LISTS = ["grantsWords", "grantsActions", "affectsTags", "wordPool", "defendsAgainst"];
const JSON_FIELDS = [];
/** Talent fields with their own editor block instead of the generic one. */
const TALENT_CUSTOM = ["prereqTalent", "crossPrereq"];

export function statLabel(key) {
  return key ? game.i18n.localize(`MODULUS.Stat.${key.replace(".", "_")}`) : "";
}

export class ModulusItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "sheet", "item"],
    position: { width: 620, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addTag: ModulusItemSheet.#onAddTag,
      removeTag: ModulusItemSheet.#onRemoveTag,
      addEffect: ModulusItemSheet.#onAddEffect,
      removeEffect: ModulusItemSheet.#onRemoveEffect,
      moveEffect: ModulusItemSheet.#onMoveEffect,
      addCfx: ModulusItemSheet.#onAddCfx,
      removeCfx: ModulusItemSheet.#onRemoveCfx,
      addCfxPart: ModulusItemSheet.#onAddCfxPart,
      removeCfxPart: ModulusItemSheet.#onRemoveCfxPart,
      openTalentGraph: () => game.modulus.openTalentGraph()
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`, scrollable: [""] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const schema = item.system.schema;
    const t = (k) => game.i18n.localize(k);
    const scalar = [];
    const isTalent = item.type === "talent";
    const walk = (field, value) => {
      if (field instanceof fields.HTMLField) return;
      if (isTalent && TALENT_CUSTOM.includes(field.name)) return;
      if (field instanceof fields.SchemaField) {
        for (const [k, f] of Object.entries(field.fields)) walk(f, value?.[k]);
        return;
      }
      if (field instanceof fields.ArrayField || field instanceof fields.ObjectField) return;
      scalar.push({ field, value });
    };
    for (const [k, f] of Object.entries(schema.fields)) walk(f, item.system._source[k]);

    const statOptions = Object.fromEntries(STAT_KEYS.map((k) => [k, statLabel(k)]));
    const registry = tagRegistry();

    // Effects editor rows.
    const effects = "effects" in schema.fields
      ? (item.system._source.effects ?? []).map((raw, index) => {
        const e = coerceEffect(raw);
        const def = EFFECT_OPS[e.op];
        const errors = validateEffect(e, { isStatKey });
        return {
          index,
          trigger: e.trigger,
          op: e.op,
          to: e.to,
          json: !def || def.json,
          argsJSON: JSON.stringify(e.args ?? {}, null, 2),
          args: (def?.args ?? []).map((a) => ({
            ...a,
            name: `_fx.${index}.args.${a.key}`,
            label: t(`MODULUS.Effect.Arg.${a.key}`),
            value: e.args?.[a.key] ?? "",
            isInt: a.type === "int",
            isBool: a.type === "bool",
            isStat: a.type === "stat",
            isSelect: a.type === "select",
            isTag: a.type === "tag",
            isText: a.type === "text",
            options: a.type === "select" ? Object.fromEntries(a.options.map((o) => [o, t(`MODULUS.Effect.Option.${o}`)])) : null
          })),
          description: describeEffect(e, { stat: statLabel }),
          errors: errors.map((err) => game.i18n.format(`MODULUS.Effect.Error.${err.split(":")[0]}`, { arg: err.split(":")[1] ?? "" }))
        };
      })
      : null;

    Object.assign(context, {
      item,
      system: item.system,
      scalar,
      hasTags: "tags" in schema.fields,
      tags: (item.system._source.tags ?? []).map((tag, index) => {
        const reg = registry.find((r) => r.name === tag.name);
        return { ...tag, index, engine: reg?.engine, tooltip: reg?.description || "" };
      }),
      registry,
      hasEffects: effects !== null,
      effects,
      triggerOptions: Object.fromEntries(EFFECT_TRIGGERS.map((k) => [k, t(`MODULUS.Effect.Trigger.${k}`)])),
      targetOptions: Object.fromEntries(EFFECT_TARGETS.map((k) => [k, t(`MODULUS.Effect.To.${k}`)])),
      opOptions: Object.fromEntries(Object.keys(EFFECT_OPS).map((k) => [k, t(`MODULUS.Effect.Op.${k}`)])),
      statOptions,
      lists: STRING_LISTS.filter((k) => k in schema.fields).map((k) => ({
        key: k,
        label: t(`MODULUS.Field.${k}`),
        value: item.system[k].join(", ")
      })),
      json: JSON_FIELDS.filter((k) => k in schema.fields).map((k) => ({
        key: k,
        label: t(`MODULUS.Field.${k}`),
        value: JSON.stringify(item.system._source[k], null, 2)
      })),
      descriptionHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description, { relativeTo: item }),
      descriptionField: schema.fields.description,
      isSkill: item.type === "skill",
      rootId: this.id
    });
    if (isTalent) context.talent = await this._prepareTalent();
    return context;
  }

  /** Talent editor (§8, §15): prerequisite pickers, graph check, principles, conditional effects. */
  async _prepareTalent() {
    const item = this.document;
    const s = item.system;
    const known = await knownTalents();
    const self = talentData(item);
    const others = [...known.values()].filter((k) => k.talentId !== self.talentId);
    const choose = (tier) => Object.fromEntries([["", "—"], ...others.filter((k) => k.tier === tier)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((k) => [k.talentId, `${k.name} (${game.i18n.localize(`MODULUS.Domain.${k.domain || "physical"}`)})`])]);
    const graph = validateTalentGraph([...others, self]).filter((i) => i.talentId === self.talentId);
    return {
      tier: s.tier,
      needsPrereq: s.tier >= 2,
      isTier3: s.tier === 3,
      prereqOptions: choose(s.tier - 1),
      crossOptions: choose(1),
      prereq: s.prereqTalent,
      cross: s.crossPrereq,
      issues: graph.map(issueText),
      cfx: editorRows(item.system._source.conditionalEffects)
    };
  }

  /** Rebuild structured fields from the flat form inputs before update. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = (data.system ??= {});
    const src = this.document.system._source;

    if (data._tags) {
      sys.tags = Object.entries(data._tags).sort((a, b) => a[0] - b[0]).map(([, v]) => normalizeTag(v)).filter((x) => x.name);
    }
    delete data._tags;

    if (data._fx) {
      sys.effects = Object.entries(data._fx).sort((a, b) => a[0] - b[0]).map(([i, row]) => {
        const prev = src.effects?.[i] ?? {};
        const def = EFFECT_OPS[row.op];
        let args = row.args ?? {};
        if (row.op !== prev.op) args = defaultArgs(row.op); // op changed: start from its defaults
        else if (def?.json) {
          try {
            args = JSON.parse(row.argsJSON || "{}");
          } catch (err) {
            ui.notifications.error(game.i18n.format("MODULUS.Item.JSONError", { field: `effect ${Number(i) + 1}`, error: err.message }));
            args = prev.args ?? {};
          }
        }
        return coerceEffect({ trigger: row.trigger, op: row.op, to: row.to, args });
      });
    }
    delete data._fx;

    if (data._cfx) sys.conditionalEffects = recordsFromForm(data._cfx, src.conditionalEffects ?? []);
    delete data._cfx;

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

  /* ---------------- Tags ---------------- */

  static async #onAddTag(event, target) {
    if (!this.isEditable) return;
    const input = this.element.querySelector("input.new-tag");
    const raw = input?.value?.trim();
    if (!raw) return;
    const m = raw.match(/^(.*?)\s+(-?\d+)$/);
    const tag = normalizeTag(m ? { name: m[1], value: Number(m[2]) } : { name: raw, value: 0 });
    const tags = [...(this.document.system._source.tags ?? []), tag];
    await this.document.update({ "system.tags": tags });
  }

  static async #onRemoveTag(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.closest("[data-index]").dataset.index);
    const tags = (this.document.system._source.tags ?? []).filter((_, n) => n !== i);
    await this.document.update({ "system.tags": tags });
  }

  /* ---------------- Effects ---------------- */

  static async #onAddEffect(event, target) {
    if (!this.isEditable) return;
    const op = this.element.querySelector("select.new-effect-op")?.value || "note";
    const effects = [...(this.document.system._source.effects ?? []), newEffect(op)];
    await this.document.update({ "system.effects": effects });
  }

  static async #onRemoveEffect(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.closest("[data-index]").dataset.index);
    const effects = (this.document.system._source.effects ?? []).filter((_, n) => n !== i);
    await this.document.update({ "system.effects": effects });
  }

  /* ---------------- Conditional effects (§8.1) ---------------- */

  #cfx() {
    return foundry.utils.deepClone(this.document.system._source.conditionalEffects ?? []);
  }

  static async #onAddCfx() {
    if (!this.isEditable) return;
    await this.document.update({ "system.conditionalEffects": [...this.#cfx(), newRecord()] });
  }

  static async #onRemoveCfx(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.closest("[data-cfx]").dataset.cfx);
    await this.document.update({ "system.conditionalEffects": this.#cfx().filter((_, n) => n !== i) });
  }

  /** Add a condition, tier shift or dice row to one conditional effect. */
  static async #onAddCfxPart(event, target) {
    if (!this.isEditable) return;
    const list = this.#cfx();
    const rec = list[Number(target.closest("[data-cfx]").dataset.cfx)];
    if (!rec) return;
    const part = target.dataset.part;
    if (part === "condition") (rec.conditions ??= []).push({ type: "momentum", who: "owner", op: "above", value: 0 });
    if (part === "shift") ((rec.grant ??= {}).tierShifts ??= []).push({ stat: "rollStat", delta: 1 });
    if (part === "dice") ((rec.grant ??= {}).dice ??= []).push({ stat: "any", buff: 1, debuff: 0 });
    await this.document.update({ "system.conditionalEffects": list });
  }

  static async #onRemoveCfxPart(event, target) {
    if (!this.isEditable) return;
    const list = this.#cfx();
    const rec = list[Number(target.closest("[data-cfx]").dataset.cfx)];
    if (!rec) return;
    const i = Number(target.dataset.index);
    const key = { condition: "conditions", shift: "tierShifts", dice: "dice" }[target.dataset.part];
    const arr = key === "conditions" ? rec.conditions : rec.grant?.[key];
    if (Array.isArray(arr)) arr.splice(i, 1);
    await this.document.update({ "system.conditionalEffects": list });
  }

  static async #onMoveEffect(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.closest("[data-index]").dataset.index);
    const j = i + Number(target.dataset.dir);
    const effects = [...(this.document.system._source.effects ?? [])];
    if (j < 0 || j >= effects.length) return;
    [effects[i], effects[j]] = [effects[j], effects[i]];
    await this.document.update({ "system.effects": effects });
  }
}
