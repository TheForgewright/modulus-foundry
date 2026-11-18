/**
 * Stand-in Foundry globals for loading the system in Node. Only what module top levels and the
 * init hook touch. It records registrations so checks can inspect them; it is not Foundry.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SYSTEM_PREFIX = "systems/modulus/";

const hooks = new Map();
export const Hooks = {
  on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push({ fn, once: false }); return hooks.get(name).length; },
  once(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push({ fn, once: true }); return hooks.get(name).length; },
  off() {},
  callAll(name, ...args) {
    for (const h of hooks.get(name) ?? []) h.fn(...args);
    hooks.set(name, (hooks.get(name) ?? []).filter((h) => !h.once));
    return true;
  },
  names: () => [...hooks.keys()]
};

export const registry = { settings: new Map(), menus: new Map(), sheets: [], templates: [], missingTemplates: [] };

class Document {
  getFlag() { return undefined; }
}

export function installFoundryStubs() {
  const app = class ApplicationV2 {};
  const mixin = (Base) => class extends Base {};
  globalThis.foundry = {
    abstract: { TypeDataModel: class TypeDataModel {}, DataModel: class DataModel {} },
    data: { fields: {} },
    dice: { Roll: class Roll {} },
    applications: {
      api: { ApplicationV2: app, HandlebarsApplicationMixin: mixin, DialogV2: class DialogV2 {} },
      sheets: { ActorSheetV2: class ActorSheetV2 {}, ItemSheetV2: class ItemSheetV2 {} },
      apps: { DocumentSheetConfig: { registerSheet: (doc, ns, cls, opts) => registry.sheets.push({ doc, cls, opts }) } },
      handlebars: {
        loadTemplates: async (paths) => {
          for (const p of paths) {
            registry.templates.push(p);
            if (!p.startsWith(SYSTEM_PREFIX) || !existsSync(ROOT + p.slice(SYSTEM_PREFIX.length))) registry.missingTemplates.push(p);
          }
          return [];
        },
        renderTemplate: async () => ""
      },
      ux: { TextEditor: { implementation: {} }, FormDataExtended: class {} },
      instances: new Map()
    },
    utils: { escapeHTML: (s) => String(s), randomID: () => "xxxx", debounce: (f) => f, mergeObject: (a, b) => ({ ...a, ...b }) }
  };
  Object.assign(globalThis, {
    Hooks,
    Actor: class Actor extends Document {},
    Item: class Item extends Document {},
    Combat: class Combat extends Document {},
    Combatant: class Combatant extends Document {},
    ChatMessage: class ChatMessage extends Document {},
    CONFIG: { Actor: { dataModels: {} }, Item: { dataModels: {} }, Combat: {}, Combatant: {}, Dice: { rolls: [], randomUniform: Math.random }, queries: {} },
    ui: { notifications: { info() {}, warn() {}, error() {} } },
    game: {
      settings: {
        register: (ns, key, data) => registry.settings.set(key, data),
        registerMenu: (ns, key, data) => registry.menus.set(key, data),
        get: (ns, key) => registry.settings.get(key)?.default
      },
      i18n: { localize: (k) => k, format: (k) => k },
      user: { isGM: true },
      ready: false
    }
  });
}
