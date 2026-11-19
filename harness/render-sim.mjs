/**
 * Simulation layer for the render check: Foundry globals detailed enough to run the system's own
 * data models, preparation and window context code in Node, plus Foundry's Handlebars helpers on
 * real Handlebars. It is not Foundry; it covers what the system's code paths touch.
 */
import Handlebars from "handlebars";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const getProperty = (o, p) => String(p).split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const setProperty = (o, p, v) => {
  const keys = String(p).split(".");
  let t = o;
  for (const k of keys.slice(0, -1)) t = t[k] ??= {};
  t[keys.at(-1)] = v;
};

/* ---------------- i18n with Foundry's semantics (missing key -> the key itself) ---------------- */

export function localize(key) {
  const v = getProperty(lang, key);
  return typeof v === "string" ? v : key;
}
export function format(key, data = {}) {
  return localize(key).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
}

/* ---------------- Data fields ---------------- */

class DataField {
  static DEFAULT = null;
  constructor(options = {}) {
    this.options = options;
    this.label = options.label ?? "";
    this.choices = options.choices;
    this.nullable = options.nullable;
  }
  getInitial() {
    const i = this.options.initial;
    if (typeof i === "function") return i();
    return i === undefined ? clone(this.constructor.DEFAULT) : clone(i);
  }
  get fieldPath() {
    return this.parent?.fieldPath ? `${this.parent.fieldPath}.${this.name}` : this.name;
  }
}
class StringField extends DataField { static DEFAULT = ""; }
class NumberField extends DataField { static DEFAULT = null; }
class BooleanField extends DataField { static DEFAULT = false; }
class HTMLField extends StringField {}
class ObjectField extends DataField { static DEFAULT = {}; }
class ArrayField extends DataField {
  static DEFAULT = [];
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}
class SetField extends ArrayField {}
class SchemaField extends DataField {
  constructor(fields, options = {}) {
    super(options);
    this.fields = fields;
    for (const [k, f] of Object.entries(fields)) {
      f.name = k;
      f.parent = this;
    }
  }
  getInitial() {
    return Object.fromEntries(Object.entries(this.fields).map(([k, f]) => [k, f.getInitial()]));
  }
}
export const fields = { DataField, StringField, NumberField, BooleanField, HTMLField, ObjectField, ArrayField, SetField, SchemaField };

function mergeDeep(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(over) || typeof over !== "object" || over === null) return clone(over);
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) out[k] = mergeDeep(out[k], v);
  return out;
}

/** A TypeDataModel instance: schema initial values, overridden by `source`, then prepareDerivedData. */
export function makeSystem(Model, source = {}) {
  const schema = new SchemaField(Model.defineSchema());
  schema.name = "system";
  const data = mergeDeep(schema.getInitial(), source);
  const sys = Object.create(Model.prototype);
  Object.assign(sys, clone(data));
  Object.defineProperty(sys, "_source", { value: clone(data), enumerable: false });
  Object.defineProperty(sys, "schema", { value: schema, enumerable: false });
  Object.defineProperty(sys, "toObject", { value: () => clone(data), enumerable: false });
  sys.prepareDerivedData?.();
  return sys;
}

/* ---------------- Collections and documents ---------------- */

export class Collection extends Map {
  get contents() { return [...this.values()]; }
  map(fn) { return this.contents.map(fn); }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  every(fn) { return this.contents.every(fn); }
  first() { return this.contents[0]; }
  [Symbol.iterator]() { return this.values(); }
}

class Document {
  getFlag(ns, key) { return getProperty(this.flags?.[ns], key); }
  async setFlag() {}
  async unsetFlag() {}
  async update() {}
  testUserPermission() { return true; }
  get isOwner() { return true; }
}

/* ---------------- Handlebars with Foundry's helpers ---------------- */

export const hbs = Handlebars.create();
const choicesOf = (c) => (typeof c === "function" ? c() : c);
const esc = (v) => Handlebars.escapeExpression(v);

function selectOptions(choices, options) {
  const { selected, localize: loc, blank } = options.hash ?? {};
  const list = choicesOf(choices) ?? {};
  const entries = Array.isArray(list) ? list.map((v) => (typeof v === "object" ? [v.value, v.label] : [v, v])) : Object.entries(list);
  let html = blank != null ? `<option value="">${esc(blank)}</option>` : "";
  for (const [value, label] of entries) {
    const text = loc ? localize(label) : label;
    html += `<option value="${esc(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${esc(text)}</option>`;
  }
  return new Handlebars.SafeString(html);
}

function inputFor(field, hash) {
  const name = hash.name ?? field.fieldPath;
  const value = hash.value ?? "";
  const choices = choicesOf(field.choices);
  if (field instanceof HTMLField) return `<prose-mirror name="${esc(name)}">${hash.enriched ?? esc(value)}</prose-mirror>`;
  if (field instanceof BooleanField) return `<input type="checkbox" name="${esc(name)}"${value ? " checked" : ""}>`;
  if (choices) {
    const opts = selectOptions(choices, { hash: { selected: value, localize: hash.localize } }).toString();
    return `<select name="${esc(name)}">${opts}</select>`;
  }
  if (field instanceof NumberField) return `<input type="number" name="${esc(name)}" value="${esc(value ?? "")}">`;
  return `<input type="text" name="${esc(name)}" value="${esc(value)}">`;
}

hbs.registerHelper({
  localize: (key, options) => {
    const hash = options?.hash ?? {};
    return Object.keys(hash).length ? format(key, hash) : localize(key);
  },
  concat: (...args) => args.slice(0, -1).join(""),
  checked: (v) => (v ? "checked" : ""),
  disabled: (v) => (v ? "disabled" : ""),
  selectOptions,
  formInput: (field, options) => new Handlebars.SafeString(inputFor(field, options.hash ?? {})),
  formGroup: (field, options) => {
    const hash = options.hash ?? {};
    const label = hash.localize ? localize(field.label) : field.label;
    return new Handlebars.SafeString(`<div class="form-group"><label>${esc(label)}</label>${inputFor(field, hash)}</div>`);
  }
});

const compiled = new Map();
export function templatePath(path) {
  const rel = String(path).replace(/^systems\/modulus\//, "").replace("${SYSTEM_ID}", "modulus");
  return join(ROOT, rel);
}
export function renderFile(path, context) {
  const file = templatePath(path);
  if (!existsSync(file)) throw new Error(`template not found: ${path}`);
  if (!compiled.has(file)) compiled.set(file, hbs.compile(readFileSync(file, "utf8"), { strict: false }));
  return compiled.get(file)(context, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
}

/* ---------------- Globals ---------------- */

class ApplicationV2 {
  constructor(options = {}) {
    this.options = options;
    this.id = options.id ?? "app";
    this.tabGroups ??= {};
  }
  async _prepareContext() { return {}; }
  get isEditable() { return true; }
  render() { return this; }
}
class DocumentSheet extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.document = options.document;
  }
  async _prepareContext() {
    return { document: this.document, source: this.document.system?._source, editable: true, user: game.user };
  }
}

class Roll {
  constructor(formula, data = {}, options = {}) {
    this.formula = formula;
    this.options = options;
  }
  async evaluate() {
    await this._evaluate();
    this._evaluated = true;
    return this;
  }
  async _evaluate() {
    const n = parseInt(this.formula, 10);
    const faces = this.options.faces ?? Array.from({ length: n }, (_, i) => 1 + ((i * 7 + 3) % 20));
    this.dice = [{ results: faces.map((result) => ({ result, active: true })) }];
  }
  _evaluateTotal() { return 0; }
}

export const registry = { settings: new Map(), hooks: new Map() };

export function installSim() {
  const users = [{ id: "gm", name: "Gamemaster", isGM: true, active: true, isSelf: true, character: null }];
  const targets = new Set();
  targets.first = () => targets.values().next().value;
  globalThis.foundry = {
    abstract: { TypeDataModel: class TypeDataModel {}, DataModel: class DataModel {} },
    data: { fields },
    dice: { Roll },
    applications: {
      api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class DialogV2 {} },
      sheets: { ActorSheetV2: DocumentSheet, ItemSheetV2: DocumentSheet },
      apps: { DocumentSheetConfig: { registerSheet() {} } },
      handlebars: { loadTemplates: async () => [], renderTemplate: async (path, data) => renderFile(path, data) },
      ux: { TextEditor: { implementation: { enrichHTML: async (s) => s ?? "", getDragEventData: () => null } }, FormDataExtended: class {} },
      instances: new Map()
    },
    utils: {
      escapeHTML: (s) => esc(s), randomID: (n = 8) => "x".repeat(n), debounce: (f) => f, getProperty, setProperty,
      deepClone: clone, mergeObject: (a, b) => mergeDeep(a, b), expandObject: (o) => o
    }
  };
  const hooks = registry.hooks;
  Object.assign(globalThis, {
    Hooks: {
      on: (n, fn) => { if (!hooks.has(n)) hooks.set(n, []); hooks.get(n).push(fn); return 1; },
      once: (n, fn) => { if (!hooks.has(n)) hooks.set(n, []); hooks.get(n).push(fn); return 1; },
      off() {},
      callAll: (n, ...args) => { for (const fn of hooks.get(n) ?? []) fn(...args); return true; }
    },
    Actor: class Actor extends Document {},
    Item: class Item extends Document {},
    Combat: class Combat extends Document {},
    Combatant: class Combatant extends Document {},
    ChatMessage: Object.assign(class ChatMessage extends Document {}, { getSpeaker: () => ({}), create: async () => null }),
    Folder: class Folder extends Document {},
    CONFIG: { Actor: { dataModels: {} }, Item: { dataModels: {} }, Combat: {}, Combatant: {}, Dice: { rolls: [], randomUniform: () => 0.5 }, queries: {} },
    ui: { notifications: { info() {}, warn() {}, error() {} } },
    fromUuid: async (u) => findByUuid(u),
    fromUuidSync: (u) => findByUuid(u),
    game: {
      settings: {
        register: (ns, key, data) => registry.settings.set(key, { ...data, value: data.default }),
        registerMenu() {},
        get: (ns, key) => registry.settings.get(key)?.value,
        set: async (ns, key, v) => { registry.settings.get(key).value = v; }
      },
      i18n: { localize, format },
      user: { id: "gm", isGM: true, targets, character: null },
      users: Object.assign(users, { activeGM: users[0] }),
      items: new Collection(),
      actors: new Collection(),
      combats: new Collection(),
      folders: new Collection(),
      scenes: new Collection(),
      packs: Object.assign([], { get: () => null }),
      system: { version: "0.0.0" },
      ready: true,
      modulus: {}
    }
  });
}

function findByUuid(uuid) {
  for (const item of game.items) if (item.uuid === uuid) return item;
  for (const actor of game.actors) {
    if (actor.uuid === uuid) return actor;
    for (const item of actor.items) if (item.uuid === uuid) return item;
  }
  return null;
}

/* ---------------- Builders for stand-in documents ---------------- */

let seq = 0;
export function makeItem(ModulusItem, models, type, { name, system = {}, flags = {}, parent = null, id } = {}) {
  const item = Object.create(ModulusItem.prototype);
  const _id = id ?? `item${++seq}`;
  Object.assign(item, {
    id: _id, _id, type, name: name ?? type, img: "icons/svg/item-bag.svg", flags, parent, sort: seq, pack: null, _stats: {},
    system: makeSystem(models[type], system)
  });
  item.uuid = parent ? `${parent.uuid}.Item.${_id}` : `Item.${_id}`;
  item.sheet = { render() {} };
  return item;
}

export function makeActor(ModulusActor, Model, { name, system = {}, items = [], flags = {}, id } = {}) {
  const actor = Object.create(ModulusActor.prototype);
  const _id = id ?? `actor${++seq}`;
  Object.assign(actor, { id: _id, _id, name, img: "icons/svg/mystery-man.svg", flags, isToken: false, items: new Collection(), uuid: `Actor.${_id}` });
  actor.type = Model.isNPC ? "npc" : "character";
  actor.system = makeSystem(Model, system);
  for (const make of items) {
    const item = make(actor);
    actor.items.set(item.id, item);
  }
  actor.sheet = { render() {} };
  return actor;
}
