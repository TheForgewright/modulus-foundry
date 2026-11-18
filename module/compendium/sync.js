/**
 * Keeps world copies of the system's compendium entries current (rules/compendium-sync.js).
 *
 * - Every Item created from a Modulus compendium gets a fingerprint of what it was created from.
 * - When the GM loads the world on a new system version, unedited copies (world Items and Items on
 *   actors) are updated from the compendium; edited and orphaned copies are reported.
 * - "Sync from compendiums" in the Vocabulary Editor reviews edited copies and updates the chosen ones.
 */
import { SYSTEM_ID } from "../config.js";
import { contentHash, planSync } from "../rules/compendium-sync.js";
import { getSetting } from "../settings.js";

const PREFIX = `Compendium.${SYSTEM_ID}.`;

export function sourceOf(item) {
  const src = item._stats?.compendiumSource ?? item.getFlag?.(SYSTEM_ID, "compendiumSource") ?? null;
  return typeof src === "string" && src.startsWith(PREFIX) ? src : null;
}

function itemData(doc) {
  return { name: doc.name, img: doc.img, system: doc.system.toObject() };
}

/** Fingerprint new copies from a Modulus compendium as they are created. */
export function registerSyncHooks() {
  Hooks.on("preCreateItem", (item) => {
    const src = sourceOf(item);
    if (!src || item.pack) return;
    item.updateSource({
      [`flags.${SYSTEM_ID}.compendiumSource`]: src,
      [`flags.${SYSTEM_ID}.syncHash`]: contentHash(item.type, itemData(item))
    });
  });

  Hooks.once("ready", async () => {
    if (!game.users.activeGM?.isSelf) return;
    const version = game.system.version;
    if (getSetting("compendiumSyncedVersion") === version) return;
    if (getSetting("autoSyncCompendiums")) {
      const report = await syncCompendiumCopies({ includeEdited: false });
      await postReport(report, version);
    }
    await game.settings.set(SYSTEM_ID, "compendiumSyncedVersion", version);
  });
}

/** The system's Item compendium entries, by uuid. */
export async function compendiumEntries() {
  const entries = new Map();
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "system" || pack.metadata.packageName !== SYSTEM_ID || pack.documentName !== "Item") continue;
    for (const doc of await pack.getDocuments()) entries.set(doc.uuid, { type: doc.type, data: itemData(doc) });
  }
  return entries;
}

/** Every world Item and actor-owned Item that came from a Modulus compendium. */
export function compendiumCopies() {
  const copies = [];
  const add = (item, owner) => {
    const sourceUuid = sourceOf(item);
    if (!sourceUuid) return;
    copies.push({
      key: item.uuid,
      item,
      owner,
      type: item.type,
      sourceUuid,
      syncHash: item.getFlag(SYSTEM_ID, "syncHash"),
      data: itemData(item),
      label: owner ? `${owner.name}: ${item.name}` : item.name
    });
  };
  for (const item of game.items) add(item, null);
  for (const actor of game.actors) for (const item of actor.items) add(item, actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorLink || !token.actor) continue;
      for (const item of token.actor.items) add(item, token.actor);
    }
  }
  return copies;
}

export async function syncPlan() {
  return planSync(compendiumCopies(), await compendiumEntries());
}

/** Write changes, grouped per parent so each actor updates once. */
async function write(rows, withChange = true) {
  const groups = new Map();
  for (const r of rows) {
    const parent = r.item.parent ?? null;
    if (!groups.has(parent)) groups.set(parent, []);
    const update = { _id: r.item.id, [`flags.${SYSTEM_ID}.syncHash`]: withChange ? r.change.syncHash : r.hash };
    if (withChange) Object.assign(update, { name: r.change.name, img: r.change.img, system: r.change.system });
    groups.get(parent).push(update);
  }
  for (const [parent, updates] of groups) {
    if (parent) await parent.updateEmbeddedDocuments("Item", updates);
    else await Item.updateDocuments(updates);
  }
}

/**
 * Update copies from the compendium. Unedited copies always; edited ones only when listed.
 * @param {{includeEdited?: boolean|string[]}} opts  true for all edited copies, or the uuids to include
 */
export async function syncCompendiumCopies({ includeEdited = false } = {}) {
  const plan = await syncPlan();
  const edited = includeEdited === true ? plan.edited
    : Array.isArray(includeEdited) ? plan.edited.filter((r) => includeEdited.includes(r.key)) : [];
  await write([...plan.update, ...edited]);
  await write(plan.current.filter((r) => r.needsHash), false);
  return { updated: [...plan.update, ...edited], edited: plan.edited.filter((r) => !edited.includes(r)), orphan: plan.orphan };
}

async function postReport(report, version) {
  const { updated, edited, orphan } = report;
  if (!updated.length && !edited.length && !orphan.length) return;
  const list = (rows) => `<ul>${rows.slice(0, 20).map((r) => `<li>${foundry.utils.escapeHTML(r.label)}</li>`).join("")}${rows.length > 20 ? `<li>…</li>` : ""}</ul>`;
  let content = `<h3>${game.i18n.format("MODULUS.Sync.ReportTitle", { version })}</h3>`;
  if (updated.length) content += `<p>${game.i18n.format("MODULUS.Sync.Updated", { n: updated.length })}</p>${list(updated)}`;
  if (edited.length) content += `<p>${game.i18n.format("MODULUS.Sync.EditedWaiting", { n: edited.length })}</p>${list(edited)}`;
  if (orphan.length) content += `<p>${game.i18n.format("MODULUS.Sync.Orphans", { n: orphan.length })}</p>${list(orphan)}`;
  await ChatMessage.create({ content, whisper: game.users.filter((u) => u.isGM).map((u) => u.id), speaker: { alias: "Modulus" } });
}

/** Review dialog: update unedited copies and the chosen edited ones. */
export async function openSyncDialog() {
  const plan = await syncPlan();
  const t = (k) => game.i18n.localize(k);
  if (!plan.update.length && !plan.edited.length) {
    ui.notifications.info(game.i18n.format("MODULUS.Sync.AllCurrent", { n: plan.current.length }));
    if (plan.current.some((r) => r.needsHash)) await write(plan.current.filter((r) => r.needsHash), false);
    return;
  }
  const esc = foundry.utils.escapeHTML;
  const rows = plan.edited.map((r) => `<li><label><input type="checkbox" name="pick" value="${esc(r.key)}"> ${esc(r.label)}</label></li>`).join("");
  const content = `
    <p>${game.i18n.format("MODULUS.Sync.DialogUnedited", { n: plan.update.length })}</p>
    ${plan.edited.length ? `<p>${t("MODULUS.Sync.DialogEdited")}</p><ul class="modulus-sync-list">${rows}</ul>` : ""}
    ${plan.orphan.length ? `<p class="hint">${game.i18n.format("MODULUS.Sync.Orphans", { n: plan.orphan.length })}</p>` : ""}`;
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "MODULUS.Sync.Title" },
    classes: ["modulus"],
    content,
    rejectClose: false,
    buttons: [{
      action: "sync",
      label: "MODULUS.Sync.Run",
      icon: "fa-solid fa-rotate",
      default: true,
      callback: (event, button) => [...button.form.querySelectorAll('input[name="pick"]:checked')].map((el) => el.value)
    }, { action: "cancel", label: "Cancel" }]
  });
  if (!Array.isArray(picked)) return;
  const report = await syncCompendiumCopies({ includeEdited: picked });
  ui.notifications.info(game.i18n.format("MODULUS.Sync.Done", { n: report.updated.length }));
}
