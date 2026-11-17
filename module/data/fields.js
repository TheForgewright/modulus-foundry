/** Shared schema helpers. */
import { STAT_KEYS, DOMAINS, TIERS } from "../rules/constants.js";

const f = () => foundry.data.fields;
export const L = (key) => `MODULUS.Field.${key}`;

export function intField(initial = 0, opts = {}) {
  return new (f().NumberField)({ required: true, nullable: false, integer: true, initial, ...opts });
}

export function statKeyField(opts = {}) {
  return new (f().StringField)({ required: true, blank: true, initial: "", choices: () => statChoices(), ...opts });
}

export function domainField(opts = {}) {
  return new (f().StringField)({
    required: true, blank: true, initial: "",
    choices: () => Object.fromEntries(DOMAINS.map((d) => [d, game.i18n.localize(`MODULUS.Domain.${d}`)])),
    ...opts
  });
}

export function tierField(opts = {}) {
  return new (f().StringField)({
    required: true, blank: false, initial: "secondary",
    choices: () => Object.fromEntries(TIERS.map((t) => [t, game.i18n.localize(`MODULUS.Tier.${t}`)])),
    ...opts
  });
}

export function statChoices() {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, game.i18n.localize(`MODULUS.Stat.${k.replace(".", "_")}`)]));
}

/** Tags (§6.4): {name, value}[]. Value 0 = no intensity. */
export function tagsField() {
  const { ArrayField, SchemaField, StringField } = f();
  return new ArrayField(new SchemaField({
    name: new StringField({ required: true, blank: false }),
    value: intField(0)
  }), { label: L("tags") });
}

/**
 * Effects (§6.3). Typed rows `{trigger, op, args, to}`. Kept loosely typed until
 * the Phase 2 effects editor fixes the schema with the designers.
 */
export function effectsField(label = "effects") {
  const { ArrayField, ObjectField } = f();
  return new ArrayField(new ObjectField(), { label: L(label) });
}

/** Organisational labels for the vocabulary editor (§6.1). */
export function groupsField() {
  const { SchemaField, StringField } = f();
  const s = (k) => new StringField({ required: true, blank: true, initial: "", label: L(`groups.${k}`) });
  return new SchemaField({ tree: s("tree"), tier1: s("tier1"), tier2: s("tier2"), tier3: s("tier3") });
}

export function descriptionField() {
  return new (f().HTMLField)({ required: true, blank: true, initial: "", label: L("description") });
}
