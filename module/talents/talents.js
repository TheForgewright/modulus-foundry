/**
 * Talents on characters (§8): known talents, eligibility with reasons, taking a talent for its XP
 * cost, removing one with a refund, and stable talent ids.
 */
import { SYSTEM_ID } from "../config.js";
import { talentEligibility, talentSlug, validateTalentGraph } from "../rules/talents.js";
import { sourceOf } from "../compendium/sync.js";

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
    xpCost: s.xpCost ?? 0,
    uuid: item.uuid,
    img: item.img
  };
}

/** Every talent a character could take: world Items, then the system's compendiums. World copies win. */
export async function knownTalents() {
  const byId = new Map();
  for (const item of game.items.filter((i) => i.type === "talent")) {
    const t = talentData(item);
    if (!byId.has(t.talentId)) byId.set(t.talentId, t);
  }
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "system" || pack.metadata.packageName !== SYSTEM_ID || pack.documentName !== "Item") continue;
    for (const item of await pack.getDocuments({ type: "talent" })) {
      const t = talentData(item);
      if (!byId.has(t.talentId)) byId.set(t.talentId, { ...t, fromPack: pack.title });
    }
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

export function eligibilityFor(actor, talent, byId) {
  return talentEligibility(talent, ownedTalents(actor), byId, { xpAvailable: xpAvailable(actor) });
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
  return validateTalentGraph([...(await knownTalents()).values()]);
}

export function issueText(i) {
  return game.i18n.format(`MODULUS.Talent.Issue.${i.code}`, { ...i, name: i.name ?? i.talentId });
}

/** New world talents get a unique talentId from their name. */
export function registerTalentHooks() {
  Hooks.on("preCreateItem", (item) => {
    if (item.type !== "talent" || item.system.talentId) return;
    const taken = new Set(game.items.filter((i) => i.type === "talent").map((i) => i.system.talentId));
    const base = talentSlug(item.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    item.updateSource({ "system.talentId": id });
  });
}
