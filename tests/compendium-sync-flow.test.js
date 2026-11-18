// The reported case end to end: a compendium entry changes in a new system version; world copies follow.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, Collection } from "./harness/foundry-mock.js";
import { SETTING_DEFAULTS } from "../module/settings.js";
import { contentHash } from "../module/rules/compendium-sync.js";

let sync;
const SRC = "Compendium.modulus.words.Item.w1";

function doc({ id, type, name, system, flags = {}, parent = null, uuid }) {
  return {
    id, type, name, img: "i.svg", parent, uuid: uuid ?? `Item.${id}`, flags,
    _stats: {},
    system: { ...system, toObject() { const { toObject, ...rest } = this; return structuredClone(rest); } },
    getFlag(ns, key) { return this.flags[ns]?.[key]; }
  };
}

function apply(target, update) {
  for (const [k, v] of Object.entries(update)) {
    if (k === "_id") continue;
    if (k === "system") Object.assign(target.system, structuredClone(v));
    else if (k.startsWith("flags.")) {
      const [, ns, key] = k.split(".");
      (target.flags[ns] ??= {})[key] = v;
    } else target[k] = v;
  }
}

before(async () => {
  installFoundryMock({ settingDefaults: SETTING_DEFAULTS });
  sync = await import("../module/compendium/sync.js");
});

test("unedited copies on actors and in the sidebar update; edited ones wait; per-copy fields are kept", async () => {
  const v1 = { momentumModifier: -1, tags: [{ name: "slow", value: 2 }] };
  const v2 = { momentumModifier: -2, tags: [{ name: "slow", value: 2 }] };
  const hash1 = contentHash("word", { name: "Steady", img: "i.svg", system: v1 });
  const flags = (h) => ({ modulus: { compendiumSource: SRC, syncHash: h } });

  // The compendium now holds v2.
  const entry = doc({ id: "w1", type: "word", name: "Steady", system: v2, uuid: SRC });
  globalThis.game.packs = [{ metadata: { packageType: "system", packageName: "modulus" }, documentName: "Item", getDocuments: async () => [entry] }];

  // World copies made from v1: one in the sidebar, one on an actor, one edited on another actor.
  const actorUpdates = [];
  const makeActor = (name) => {
    const a = { name, items: new Collection() };
    a.updateEmbeddedDocuments = async (type, updates) => {
      actorUpdates.push(...updates);
      for (const u of updates) apply(a.items.get(u._id), u);
    };
    return a;
  };
  const ava = makeActor("Ava");
  const bram = makeActor("Bram");
  const sidebar = doc({ id: "s1", type: "word", name: "Steady", system: v1, flags: flags(hash1) });
  const onAva = doc({ id: "a1", type: "word", name: "Steady", system: v1, flags: flags(hash1), parent: ava, uuid: "Actor.ava.Item.a1" });
  const edited = doc({ id: "b1", type: "word", name: "Steady", system: { ...v1, momentumModifier: 0 }, flags: flags(hash1), parent: bram, uuid: "Actor.bram.Item.b1" });
  ava.items.set("a1", onAva);
  bram.items.set("b1", edited);
  globalThis.game.items = new Collection([["s1", sidebar]]);
  globalThis.game.actors = new Collection([["ava", ava], ["bram", bram]]);
  globalThis.game.scenes = new Collection();
  globalThis.Item = { updateDocuments: async (updates) => { for (const u of updates) apply(game.items.get(u._id), u); } };

  const report = await sync.syncCompendiumCopies();
  assert.deepEqual(report.updated.map((r) => r.label).sort(), ["Ava: Steady", "Steady"]);
  assert.deepEqual(report.edited.map((r) => r.label), ["Bram: Steady"]);
  assert.equal(sidebar.system.momentumModifier, -2);
  assert.equal(onAva.system.momentumModifier, -2);
  assert.equal(edited.system.momentumModifier, 0);
  assert.equal(onAva.flags.modulus.syncHash, contentHash("word", { name: "Steady", img: "i.svg", system: v2 }));

  // Running again changes nothing; the GM can then choose to replace the edited copy.
  assert.equal((await sync.syncCompendiumCopies()).updated.length, 0);
  const forced = await sync.syncCompendiumCopies({ includeEdited: ["Actor.bram.Item.b1"] });
  assert.equal(forced.updated.length, 1);
  assert.equal(edited.system.momentumModifier, -2);
});
