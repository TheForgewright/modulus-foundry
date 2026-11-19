/**
 * The system's compendium content, read directly (option 2: nothing is copied into worlds).
 * Loaded once on every client when the world is ready, and reloaded when a system compendium
 * entry changes. World Items made from an entry override it (rules/catalog.js).
 */
import { SYSTEM_ID } from "../config.js";
import { mergeCatalog } from "../rules/catalog.js";
import { sourceOf } from "../compendium/sync.js";

let cache = [];
let loading = null;

function systemPacks() {
  return game.packs.filter((p) => p.metadata.packageType === "system" && p.metadata.packageName === SYSTEM_ID && p.documentName === "Item");
}

/** (Re)load every Item from the system's compendiums. */
export async function loadCatalog() {
  loading = (async () => {
    const docs = [];
    for (const pack of systemPacks()) docs.push(...(await pack.getDocuments()));
    cache = docs;
    Hooks.callAll(`${SYSTEM_ID}.catalogReady`);
    return cache;
  })();
  return loading;
}

/** Wait for the first load (for async callers). */
export async function catalogReady() {
  return loading ?? loadCatalog();
}

/**
 * World Items of a type plus the system's compendium entries of that type, with world copies
 * overriding the entry they came from. Synchronous: uses what is loaded.
 */
export function catalogItems(type) {
  const world = game.items.filter((i) => i.type === type).map((i) => ({ item: i, uuid: i.uuid, sourceUuid: sourceOf(i) }));
  const packs = cache.filter((i) => i.type === type).map((i) => ({ item: i, uuid: i.uuid }));
  return mergeCatalog(world, packs).map((x) => x.item);
}

export function registerCatalog() {
  Hooks.once("ready", () => loadCatalog());
  // Reload when an entry in one of the system's compendiums changes (an unlocked pack being edited).
  const reload = foundry.utils.debounce(() => loadCatalog(), 250);
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (item.pack?.startsWith(`${SYSTEM_ID}.`)) reload();
    });
  }
}
