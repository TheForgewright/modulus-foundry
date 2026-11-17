/**
 * A minimal stand-in for the Foundry globals the encounter controller touches, so a whole
 * round can run in Node. It mocks only what the code under test calls; it is not Foundry.
 */
const settings = new Map();

class Collection extends Map {
  get contents() { return [...this.values()]; }
  map(fn) { return this.contents.map(fn); }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
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
    this.dice = [{ results: Array.from({ length: n }, () => ({ result: 1 + Math.floor(globalThis.CONFIG.Dice.randomUniform() * 20), active: true })) }];
    this._total = 0;
  }
  _evaluateTotal() { return 0; }
  async toMessage() {
    return globalThis.ChatMessage.create({ rolls: [this] });
  }
}

const messages = [];

export function installFoundryMock({ settingDefaults }) {
  for (const [k, v] of Object.entries(settingDefaults)) settings.set(k, v);
  const app = class {};
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2: app, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class {} },
      sheets: { ActorSheetV2: app, ItemSheetV2: app },
      handlebars: { renderTemplate: async () => "" },
      ux: { TextEditor: { implementation: {} } },
      instances: new Map()
    },
    data: { fields: {} },
    dice: { Roll },
    utils: { escapeHTML: (s) => String(s), randomID: () => Math.random().toString(36).slice(2, 6), debounce: (f) => f, setProperty: () => {} }
  };
  globalThis.CONFIG = { Dice: { randomUniform: Math.random }, queries: {} };
  globalThis.Hooks = { on: () => 0, off: () => {}, callAll: () => {} };
  globalThis.ui = { notifications: { info: () => {}, warn: (m) => messages.push({ warn: m }), error: (m) => messages.push({ error: m }) } };
  globalThis.ChatMessage = {
    create: async (data) => {
      const m = { ...data, getFlag: () => null, setFlag: async () => {} };
      messages.push(m);
      return m;
    },
    getSpeaker: () => ({})
  };
  globalThis.game = {
    settings: { get: (ns, key) => settings.get(key) },
    i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` },
    user: { isGM: true },
    users: { activeGM: null },
    items: new Collection(),
    combats: new Collection()
  };
  return { messages, settings, Collection };
}

export { Collection };
