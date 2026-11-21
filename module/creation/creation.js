/**
 * Character creation (§3.2, §3.7) and respec (§3.4) on characters: what can be picked, the plan the
 * creation window edits, finishing creation, and spending respec points. Rules are in rules/creation.js.
 */
import { SYSTEM_ID } from "../config.js";
import { getSetting } from "../settings.js";
import { validateCreation, respecCheck, REQUIRED_BACKGROUNDS } from "../rules/creation.js";
import { sourceOf } from "../compendium/sync.js";
import { catalogItems, catalogReady } from "../vocab/catalog.js";
import { ancestryKey } from "../talents/talents.js";

/** Flag set on a character once creation is finished. */
export const CREATED_FLAG = "created";
/** Flag on items creation put on a character: the catalog entry they were copied from. */
const PICK_FLAG = "creationPick";
const PICK_TYPES = ["ancestry", "society", "background", "word"];

export function isCreated(actor) {
  return Boolean(actor.getFlag?.(SYSTEM_ID, CREATED_FLAG));
}

/** Everything creation can offer, by type, as {uuid, name, img, item, ...rule fields}. */
export async function creationCatalog() {
  await catalogReady();
  const view = (item) => ({ uuid: item.uuid, id: item.uuid, name: item.name, img: item.img, item });
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    ancestry: catalogItems("ancestry").map((i) => ({ ...view(i), ancestryId: ancestryKey(i) })).sort(byName),
    society: catalogItems("society").map((i) => ({ ...view(i), xpCost: i.system.xpCost ?? 0 })).sort(byName),
    background: catalogItems("background").map((i) => ({ ...view(i), xpCost: i.system.xpCost ?? 0, category: i.system.category })).sort(byName),
    // Base words are known by everyone (§6.2) and are not picked.
    word: catalogItems("word").filter((i) => !i.system.baseWord).map((i) => ({ ...view(i), baseWord: false })).sort(byName)
  };
}

/** The plan the window starts from: the actor's allocation and what an earlier creation picked. */
export function planFromActor(actor, catalog) {
  const picked = (type) => actor.items.filter((i) => i.type === type).map((i) => i.getFlag(SYSTEM_ID, PICK_FLAG))
    .map((uuid) => catalog[type].find((c) => c.uuid === uuid)).filter(Boolean).map((c) => c.uuid);
  const alloc = actor.system.allocation;
  return {
    allocation: { domain: alloc.domain, expression: alloc.expression, freeDot: alloc.freeDot },
    ancestry: picked("ancestry")[0] ?? null,
    society: picked("society"),
    background: picked("background"),
    word: picked("word")
  };
}

/** XP the character can spend at creation: what they have, plus what an earlier creation spent. */
export function creationXP(actor) {
  const refund = actor.items.filter((i) => i.getFlag(SYSTEM_ID, PICK_FLAG)).reduce((n, i) => n + (i.getFlag(SYSTEM_ID, "xpPaid") ?? 0), 0);
  return (actor.system.xp.total ?? 0) - (actor.system.xp.spent ?? 0) + refund;
}

/** The window's plan (uuids) as rule data, validated. */
export function checkPlan(actor, plan, catalog) {
  const find = (type, uuid) => catalog[type].find((c) => c.uuid === uuid);
  const ruleData = {
    allocation: plan.allocation,
    ancestry: plan.ancestry ? find("ancestry", plan.ancestry) ?? null : null,
    societies: plan.society.map((u) => find("society", u)).filter(Boolean),
    backgrounds: plan.background.map((u) => find("background", u)).filter(Boolean),
    words: plan.word.map((u) => find("word", u)).filter(Boolean)
  };
  const result = validateCreation(ruleData, {
    startingWords: getSetting("creation.startingWords"),
    xpAvailable: creationXP(actor),
    ancestriesExist: catalog.ancestry.length > 0,
    backgroundCategories: REQUIRED_BACKGROUNDS.filter((c) => catalog.background.some((b) => b.category === c))
  });
  return { ...result, ruleData };
}

/** Localized text for a creation error from rules/creation.js. */
export function creationErrorText(e) {
  if (e.code === "allocation") return game.i18n.localize(e.key);
  const category = e.category ? game.i18n.localize(`MODULUS.Background.${e.category}`) : "";
  return game.i18n.format(`MODULUS.Creation.Error.${e.code}`, { ...e, category });
}

/**
 * Finish creation: set the allocation, replace what an earlier creation picked with the new picks,
 * spend their XP and mark the character created.
 */
export async function finishCreation(actor, plan, catalog) {
  const check = checkPlan(actor, plan, catalog);
  if (!check.valid) {
    ui.notifications.warn(check.errors.map(creationErrorText).join(" "));
    return false;
  }
  const costOf = new Map(check.lines.map((l) => [l.id, l.cost]));
  const wanted = new Set([plan.ancestry, ...plan.society, ...plan.background, ...plan.word].filter(Boolean));
  const previous = actor.items.filter((i) => PICK_TYPES.includes(i.type) && i.getFlag(SYSTEM_ID, PICK_FLAG));
  const refund = previous.reduce((n, i) => n + (i.getFlag(SYSTEM_ID, "xpPaid") ?? 0), 0);
  const keep = new Set(previous.map((i) => i.getFlag(SYSTEM_ID, PICK_FLAG)));

  const toDelete = previous.filter((i) => !wanted.has(i.getFlag(SYSTEM_ID, PICK_FLAG))).map((i) => i.id);
  const toCreate = [];
  for (const uuid of wanted) {
    if (keep.has(uuid)) continue;
    const entry = PICK_TYPES.map((t) => catalog[t].find((c) => c.uuid === uuid)).find(Boolean);
    if (!entry) continue;
    const data = entry.item.toObject();
    delete data._id;
    const src = entry.item.pack ? entry.item.uuid : sourceOf(entry.item);
    if (src) {
      foundry.utils.setProperty(data, "_stats.compendiumSource", src);
      foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.compendiumSource`, src);
    }
    foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.${PICK_FLAG}`, uuid);
    foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.xpPaid`, costOf.get(uuid) ?? 0);
    toCreate.push(data);
  }
  // Kept items pay what they cost now (a background can turn free or extra as the picks change).
  const keptUpdates = previous.filter((i) => wanted.has(i.getFlag(SYSTEM_ID, PICK_FLAG)))
    .map((i) => ({ _id: i.id, [`flags.${SYSTEM_ID}.xpPaid`]: costOf.get(i.getFlag(SYSTEM_ID, PICK_FLAG)) ?? 0 }));

  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (keptUpdates.length) await actor.updateEmbeddedDocuments("Item", keptUpdates);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  await actor.update({
    "system.allocation": { ...plan.allocation },
    "system.xp.spent": Math.max(0, (actor.system.xp.spent ?? 0) - refund + check.cost),
    [`flags.${SYSTEM_ID}.${CREATED_FLAG}`]: true
  });
  return true;
}

/**
 * Respec (§3.4): clear the dot allocation so it can be chosen again. Free before creation is
 * finished; afterwards it spends respec points (setting respec.cost). A GM may waive the cost.
 */
export async function respec(actor, { waive = false } = {}) {
  const check = respecCheck({
    created: isCreated(actor),
    points: actor.system.respecPoints,
    cost: getSetting("respec.cost"),
    isGM: game.user.isGM,
    waive
  });
  if (!check.ok) {
    ui.notifications.warn(game.i18n.format("MODULUS.Respec.NeedPoints", { cost: getSetting("respec.cost"), have: actor.system.respecPoints }));
    return false;
  }
  await actor.update({
    "system.allocation": { domain: "", expression: "", freeDot: "" },
    "system.respecPoints": actor.system.respecPoints - check.spend
  });
  return true;
}

/** New characters start with the configured XP unless the data already sets it. */
export function registerCreationHooks() {
  Hooks.on("preCreateActor", (actor, data) => {
    if (actor.type !== "character" || foundry.utils.getProperty(data, "system.xp.total") != null) return;
    actor.updateSource({ "system.xp.total": getSetting("creation.startingXP") });
  });
}
