/**
 * Keeping world copies of compendium entries current. Pure JS, no Foundry imports.
 *
 * An Item pulled into a world (or onto an actor) from a compendium is an independent copy: when a
 * new system version ships changed compendium entries, the copies keep their old data. This decides,
 * per copy, what to do:
 *   current  same content as its compendium entry
 *   update   unchanged in the world since it was created or last synced: safe to update
 *   edited   changed in the world since then: only updated when the GM says so
 *   orphan   its compendium entry no longer exists
 * "Since it was created or last synced" is a fingerprint (syncHash) stored on the copy.
 *
 * Fields that belong to the copy, not to the entry (a status's remaining rounds,
 * whether armor is worn) are never compared or overwritten.
 */

export const KEEP_FIELDS = Object.freeze({
  status: ["value", "duration.rounds"],
  armor: ["equipped"]
});

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}

function deletePath(obj, path) {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  if (parent) delete parent[keys[keys.length - 1]];
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The compared content of an Item: name, img and system data minus the copy's own fields. */
export function syncContent(type, { name, img, system }) {
  const sys = structuredClone(system ?? {});
  for (const path of KEEP_FIELDS[type] ?? []) deletePath(sys, path);
  return { name: name ?? "", img: img ?? "", system: sys };
}

/** A short, stable fingerprint of an Item's compared content (FNV-1a over a stable serialization). */
export function contentHash(type, data) {
  const text = stable(syncContent(type, data));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** The entry's system data with the copy's own fields carried over. */
export function mergedSystem(type, entrySystem, copySystem) {
  const sys = structuredClone(entrySystem ?? {});
  for (const path of KEEP_FIELDS[type] ?? []) {
    const v = getPath(copySystem, path);
    if (v !== undefined) setPath(sys, path, v);
  }
  return sys;
}

/**
 * @param {Array<{key, type, sourceUuid, syncHash?, data: {name, img, system}}>} copies
 * @param {Map<string, {type, data: {name, img, system}}>} entries  by compendium uuid
 * @returns {{current: object[], update: object[], edited: object[], orphan: object[]}}
 *   `update` and `edited` rows carry `change: {name, img, system, syncHash}` ready to write.
 */
export function planSync(copies, entries) {
  const plan = { current: [], update: [], edited: [], orphan: [] };
  for (const copy of copies) {
    const entry = entries.get(copy.sourceUuid);
    if (!entry || entry.type !== copy.type) {
      plan.orphan.push(copy);
      continue;
    }
    const entryHash = contentHash(entry.type, entry.data);
    const copyHash = contentHash(copy.type, copy.data);
    if (copyHash === entryHash) {
      plan.current.push({ ...copy, needsHash: copy.syncHash !== entryHash, hash: entryHash });
      continue;
    }
    const change = {
      name: entry.data.name,
      img: entry.data.img,
      system: mergedSystem(entry.type, entry.data.system, copy.data.system),
      syncHash: entryHash
    };
    // No fingerprint means we can't tell whether it was edited: treat it as edited (ask first).
    const unedited = copy.syncHash && copy.syncHash === copyHash;
    (unedited ? plan.update : plan.edited).push({ ...copy, change });
  }
  return plan;
}
