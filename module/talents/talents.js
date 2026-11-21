/**
 * Talents on characters (§8): known talents, eligibility with reasons, taking a talent for its XP
 * cost, removing one with a refund, and stable talent ids.
 */
import { SYSTEM_ID } from "../config.js";
import { talentEligibility, talentSlug, validateTalentGraph } from "../rules/talents.js";
import { sourceOf } from "../compendium/sync.js";
import { catalogItems, catalogReady } from "../vocab/catalog.js";

/** Plain data the rules need from a talent Item. */
export function talentData(item) {
  const s = item.system;
  return {
    talentId: s.talentId || talentSlug(item.name),
    name: item.name,
    domain: s.domain,
    tier: s.tier,
    prereqTalent: s.prereqTalent,
    crossPrereq: s.crossPrereq,
    requires: [...(s.requires ?? [])],
    requiresAncestry: s.requiresAncestry ?? "",
    xpCost: s.xpCost ?? 0,
    uuid: item.uuid,
    img: item.img
  };
}

/** Every talent a character could take: world Items, then the system's compendiums. World copies win. */
export async function knownTalents() {
  await catalogReady();
  const byId = new Map();
  for (const item of catalogItems("talent")) {
    const t = talentData(item);
    if (byId.has(t.talentId)) continue;
    byId.set(t.talentId, item.pack ? { ...t, fromPack: game.packs.get(item.pack)?.title } : t);
  }
  return byId;
}

export function ownedTalents(actor) {
  return actor.items.filter((i) => i.type === "talent").map((i) => ({ ...talentData(i), id: i.id }));
}

export function xpAvailable(actor) {
  return (actor.system.xp?.total ?? 0) - (actor.system.xp?.spent ?? 0);
}

/** Localized "why locked" text for a reason from rules/talents.js. */
export function reasonText(r) {
  const domain = r.domain ? game.i18n.localize(`MODULUS.Domain.${r.domain}`) : "";
  return game.i18n.format(`MODULUS.Talent.Reason.${r.code}`, { ...r, domain, missing: (r.need ?? 0) - (r.have ?? 0) });
}

/** An ancestry's stable key: its ancestryId, or a slug of its name for older items. */
export function ancestryKey(item) {
  return item.system.ancestryId || talentSlug(item.name);
}

/** Every ancestry a character could have: id -> name (world Items and the system's compendiums). */
export function knownAncestries() {
  const out = new Map();
  for (const item of catalogItems("ancestry")) if (!out.has(ancestryKey(item))) out.set(ancestryKey(item), item.name);
  return out;
}

export function eligibilityFor(actor, talent, byId) {
  return talentEligibility(talent, ownedTalents(actor), byId, {
    xpAvailable: xpAvailable(actor),
    ancestries: actor.items.filter((i) => i.type === "ancestry").map(ancestryKey),
    ancestryNames: knownAncestries()
  });
}

/**
 * Take a talent: a copy on the character, its XP cost added to XP spent.
 * Players can only take eligible talents; a GM can grant one anyway (`force`).
 */
export async function takeTalent(actor, talent, byId, { force = false } = {}) {
  const check = eligibilityFor(actor, talent, byId);
  if (check.owned) return null;
  if (!check.eligible && !(force && game.user.isGM)) {
    ui.notifications.warn(check.reasons.map(reasonText).join(" "));
    return null;
  }
  const source = await fromUuid(talent.uuid);
  if (!source) return null;
  const data = source.toObject();
  delete data._id;
  if (!data.system.talentId) data.system.talentId = talent.talentId;
  const src = source.pack ? source.uuid : sourceOf(source);
  if (src) {
    foundry.utils.setProperty(data, "_stats.compendiumSource", src);
    foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.compendiumSource`, src);
  }
  foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.xpPaid`, check.cost);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (check.cost) await actor.update({ "system.xp.spent": (actor.system.xp.spent ?? 0) + check.cost });
  return created;
}

/** Remove a talent, refunding what was paid for it. */
export async function removeTalent(actor, item, { refund = true } = {}) {
  const paid = item.getFlag(SYSTEM_ID, "xpPaid") ?? item.system.xpCost ?? 0;
  await item.delete();
  if (refund && paid) await actor.update({ "system.xp.spent": Math.max(0, (actor.system.xp.spent ?? 0) - paid) });
}

/** Problems in the authored talent graph, for the editor and the graph window. */
export async function talentIssues() {
  return validateTalentGraph([...(await knownTalents()).values()], { ancestryIds: [...knownAncestries().keys()] });
}

export function issueText(i) {
  return game.i18n.format(`MODULUS.Talent.Issue.${i.code}`, { ...i, name: i.name ?? i.talentId });
}

/** New world talents and ancestries get a unique stable id from their name. */
export function registerTalentHooks() {
  const KEYS = { talent: "talentId", ancestry: "ancestryId" };
  Hooks.on("preCreateItem", (item) => {
    const key = KEYS[item.type];
    if (!key || item.system[key]) return;
    const taken = new Set(game.items.filter((i) => i.type === item.type).map((i) => i.system[key]));
    const base = talentSlug(item.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    item.updateSource({ [`system.${key}`]: id });
  });
}
