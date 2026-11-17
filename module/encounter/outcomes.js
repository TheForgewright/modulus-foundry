/**
 * Applying on-hit / on-miss / on-resolution effects (§7.8). By default the chat card offers
 * them to the GM as buttons; with `autoApplyOutcomes` they apply right after the roll.
 */
import { SYSTEM_ID } from "../config.js";
import { describeEffect } from "../rules/effects.js";
import { statLabel } from "../apps/item-sheet.js";

/** The Modulus context stored on a chat message (roll or non-roll card). */
export function messageContext(message) {
  return message.rolls?.[0]?.options?.modulus?.context ?? message.getFlag(SYSTEM_ID, "context") ?? null;
}

/** Outcome rows that apply to this message's result. */
export function relevantOutcomes(message) {
  const ctx = messageContext(message);
  if (!ctx?.outcomeEffects) return [];
  const hit = message.rolls?.[0]?.options?.modulus?.hit;
  return ctx.outcomeEffects
    .map((o, index) => ({ ...o, index }))
    .filter((o) => o.trigger === "onResolve" || (o.trigger === "onHit" && hit !== false) || (o.trigger === "onMiss" && hit === false));
}

function participants(message) {
  const ctx = messageContext(message);
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  const target = ctx.targetUuid ? fromUuidSync(ctx.targetUuid) : null;
  const combat = ctx.encounter ? game.combats.get(ctx.encounter.combatId) : null;
  const find = (a) => (combat && a ? combat.combatants.find((c) => c.actor === a || c.actorId === a.id) : null);
  return { ctx, actor, target, combat, actorCombatant: find(actor), targetCombatant: find(target) };
}

async function adjustMomentum(actor, combatant, { delta, set }) {
  if (combatant) {
    return set != null ? combatant.setMomentum(set) : combatant.adjustMomentum(delta);
  }
  if (!actor) return;
  const current = actor.system.momentum.current;
  return actor.update({ "system.momentum.current": set != null ? set : current + delta });
}

async function chooseTrack(actor) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("MODULUS.Outcome.ChooseTrack", { name: actor.name }) },
    content: `<p>${game.i18n.localize("MODULUS.Outcome.ChooseTrackHint")}</p>`,
    buttons: ["physical", "mental", "social"].map((d) => ({ action: d, label: `MODULUS.Domain.${d}` })),
    rejectClose: false
  });
}

async function applyStatus(actor, { mode, name, value }, round) {
  if (!actor || !name) return;
  if (mode === "remove") {
    const ids = actor.items.filter((i) => i.type === "status" && i.name.toLowerCase() === name.toLowerCase()).map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    return;
  }
  // Prefer the authored status from the world, so its effects and duration come along.
  const source = game.items.find((i) => i.type === "status" && i.name.toLowerCase() === name.toLowerCase());
  const data = source ? source.toObject() : { name, type: "status", system: {} };
  delete data._id;
  if (value) foundry.utils.setProperty(data, "system.value", value);
  foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.appliedRound`, round ?? 0);
  await actor.createEmbeddedDocuments("Item", [data]);
}

/**
 * Apply one effect. Returns a short text of what happened, for the chat log.
 */
export async function applyEffect(effect, { actor, target, actorCombatant, targetCombatant, combat, round }) {
  const who = effect.to === "target" ? target : actor;
  const whoCombatant = effect.to === "target" ? targetCombatant : actorCombatant;
  const a = effect.args ?? {};
  switch (effect.op) {
    case "momentum":
      await adjustMomentum(who, whoCombatant, { delta: a.delta ?? 0, set: a.set });
      break;
    case "pips": {
      if (!who) break;
      const track = a.track === "choice" || !a.track ? await chooseTrack(who) : a.track;
      if (track) await who.applyPips(track, a.delta ?? 1);
      break;
    }
    case "status":
      await applyStatus(who, a, round);
      break;
    case "restrict":
      await applyStatus(who, {
        mode: "apply",
        name: game.i18n.format("MODULUS.Outcome.Restricted", { tag: a.tag }),
        value: 0
      }, round);
      break;
    case "draw":
      if (who?.getDeck?.(combat?.id)) await who.drawCards(a.count ?? 1, combat.id);
      break;
    default:
      // note, move, dice, tierShift and others are for the GM to adjudicate.
      break;
  }
  return describeEffect(effect, { stat: statLabel });
}

export async function applyOutcome(message, index) {
  const p = participants(message);
  const row = p.ctx?.outcomeEffects?.[index];
  if (!row) return;
  await applyEffect(row.effect, { ...p, round: p.combat?.encounterState.round });
  await message.setFlag(SYSTEM_ID, `applied.${index}`, true);
}

export async function applyAllOutcomes(message) {
  for (const o of relevantOutcomes(message)) {
    if (message.getFlag(SYSTEM_ID, `applied.${o.index}`)) continue;
    await applyOutcome(message, o.index);
  }
}

/**
 * Render outcome buttons into a chat card. GMs get Apply buttons; everyone sees the list.
 */
export function decorateChatMessage(message, html) {
  const rows = relevantOutcomes(message);
  if (!rows.length) return;
  const applied = message.getFlag(SYSTEM_ID, "applied") ?? {};
  const list = document.createElement("ul");
  list.className = "modulus-outcomes";
  for (const r of rows) {
    const li = document.createElement("li");
    const done = applied[r.index];
    li.className = done ? "applied" : "";
    li.innerHTML = `<span>${foundry.utils.escapeHTML(r.text)}</span>`;
    if (game.user.isGM) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "outcome-apply";
      b.disabled = Boolean(done);
      b.innerHTML = done ? '<i class="fa-solid fa-check"></i>' : `<i class="fa-solid fa-play"></i> ${game.i18n.localize("MODULUS.Outcome.Apply")}`;
      b.addEventListener("click", async (ev) => {
        ev.preventDefault();
        b.disabled = true;
        await applyOutcome(message, r.index);
      });
      li.append(b);
    }
    list.append(li);
  }
  const card = html.querySelector(".modulus-roll-card") ?? html;
  // Remove the static outcome lists the card template rendered; this list replaces them.
  card.querySelectorAll("ul.effects").forEach((el) => el.remove());
  card.append(list);
  if (game.user.isGM && rows.some((r) => !applied[r.index]) && rows.length > 1) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "outcome-apply-all";
    all.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize("MODULUS.Outcome.ApplyAll")}`;
    all.addEventListener("click", async () => {
      all.disabled = true;
      await applyAllOutcomes(message);
    });
    card.append(all);
  }
}
