/**
 * Vocabulary JSON import / export (§15). Pure JS, no Foundry imports.
 *
 * File format:
 *   {
 *     "format": "modulus-vocabulary",
 *     "version": 1,
 *     "exportedAt": "2026-11-17T12:00:00.000Z",
 *     "items": [ { "vocabId": "…", "type": "action", "name": "Strike", "img": "…", "folder": "…", "system": { … } } ],
 *     "tags": [ { "name": "strike", "valued": false, "description": "" } ]
 *   }
 *
 * `vocabId` is a stable id that survives export -> import, so re-importing updates
 * items instead of duplicating them. `system` is the item's type data as stored.
 */

export const VOCAB_FORMAT = "modulus-vocabulary";
export const VOCAB_VERSION = 1;
export const VOCAB_TYPES = Object.freeze(["action", "word", "status", "talent"]);

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

/**
 * @param {Array<{vocabId, type, name, img?, folder?, system}>} items
 * @param {Array} tags  designer tag registry entries
 */
export function exportVocabulary(items, tags = [], { exportedAt = new Date().toISOString() } = {}) {
  const out = items
    .filter((i) => VOCAB_TYPES.includes(i.type))
    .map((i) => {
      const entry = { vocabId: String(i.vocabId), type: i.type, name: String(i.name), system: sortKeys(i.system ?? {}) };
      if (i.img) entry.img = i.img;
      if (i.folder) entry.folder = i.folder;
      return entry;
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.vocabId.localeCompare(b.vocabId));
  return {
    format: VOCAB_FORMAT,
    version: VOCAB_VERSION,
    exportedAt,
    items: out,
    tags: [...tags].map((t) => ({ name: t.name, valued: Boolean(t.valued), description: t.description ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

/**
 * Validate and normalize an import. Accepts the object or its JSON text.
 * @returns {{valid: boolean, errors: string[], items: object[], tags: object[]}}
 */
export function parseVocabulary(input) {
  const errors = [];
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return { valid: false, errors: [`json: ${err.message}`], items: [], tags: [] };
    }
  }
  if (!data || typeof data !== "object") return { valid: false, errors: ["notAnObject"], items: [], tags: [] };
  if (data.format !== VOCAB_FORMAT) errors.push("wrongFormat");
  if (typeof data.version !== "number" || data.version > VOCAB_VERSION) errors.push("unsupportedVersion");
  if (!Array.isArray(data.items)) errors.push("noItems");
  const items = [];
  const seen = new Set();
  (Array.isArray(data.items) ? data.items : []).forEach((i, n) => {
    if (!i || typeof i !== "object") return errors.push(`item ${n}: notAnObject`);
    if (!VOCAB_TYPES.includes(i.type)) return errors.push(`item ${n}: badType ${i.type}`);
    if (!i.name || typeof i.name !== "string") return errors.push(`item ${n}: noName`);
    if (!i.vocabId) return errors.push(`item ${n}: noVocabId`);
    if (seen.has(i.vocabId)) return errors.push(`item ${n}: duplicateVocabId ${i.vocabId}`);
    seen.add(i.vocabId);
    if (i.system != null && typeof i.system !== "object") return errors.push(`item ${n}: badSystem`);
    items.push({ vocabId: String(i.vocabId), type: i.type, name: i.name, img: i.img, folder: i.folder, system: i.system ?? {} });
  });
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .filter((t) => t && typeof t.name === "string" && t.name.trim())
    .map((t) => ({ name: t.name.trim().toLowerCase(), valued: Boolean(t.valued), description: String(t.description ?? "") }));
  return { valid: errors.length === 0, errors, items, tags };
}

/**
 * Plan an import against what exists: which items are created and which updated.
 * @param {object[]} incoming  parsed items
 * @param {Map<string, string>} existing  vocabId -> document id
 */
export function planImport(incoming, existing) {
  const create = [];
  const update = [];
  for (const i of incoming) (existing.has(i.vocabId) ? update : create).push({ ...i, id: existing.get(i.vocabId) });
  return { create, update };
}

/** Merge tag registries; incoming entries replace same-named ones. */
export function mergeTagRegistry(current = [], incoming = []) {
  const map = new Map(current.map((t) => [t.name, t]));
  for (const t of incoming) map.set(t.name, t);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
