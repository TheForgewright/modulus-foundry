/**
 * Applying on-hit / on-miss / on-resolution effects (§7.8). By default the chat card offers
 * them to the GM as buttons; with `autoApplyOutcomes` they apply right after the roll.
 */
import { SYSTEM_ID } from "../config.js";
import { describeEffect } from "../rules/effects.js";
import { statLabel } from "../apps/item-sheet.js";
import { catalogItems } from "../vocab/catalog.js";
import { actionMomentumChanges, linkedMomentumOps } from "../rules/extended.js";
import { combatantOf } from "./lookup.js";

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
  const find = (a) => combatantOf(combat, a);
  // Cards that know the participants' encounter ids (delayed effects) use them directly.
  const actorCombatant = (ctx.actorPid && combat?.combatants.get(ctx.actorPid)) || find(actor);
  const targetCombatant = (ctx.targetPid && combat?.combatants.get(ctx.targetPid)) || find(target);
  return {
    ctx, combat, actorCombatant, targetCombatant,
    actor: actor ?? actorCombatant?.actor ?? null,
    target: target ?? targetCombatant?.actor ?? null
  };
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
  // Prefer the authored status (world, then the system compendiums), so its effects and duration come along.
  const source = catalogItems("status").find((i) => i.name.toLowerCase() === name.toLowerCase());
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
    case "team": {
      // The apparent team in this encounter; the change itself is the teamChanged trigger.
      if (!whoCombatant) break;
      const label = { set: String(a.name ?? "").trim(), clear: "", joinActor: actorCombatant?.team ?? "", joinTarget: targetCombatant?.team ?? "" }[a.mode];
      if (label === undefined || label === whoCombatant.team) break;
      await whoCombatant.setFlag(SYSTEM_ID, "team", label);
      break;
    }
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
  if (row.effect.delay > 0 && p.combat) {
    // Delayed: scheduled in the encounter; it fires at the start of a later round.
    const { encounterController } = await import("./controller.js");
    await encounterController(p.combat).scheduleDelayed({
      effect: row.effect,
      source: row.source,
      text: row.text,
      actorPid: p.actorCombatant?.id ?? null,
      targetPid: p.targetCombatant?.id ?? null,
      actorUuid: p.actor?.uuid ?? null,
      targetUuid: p.target?.uuid ?? null,
      linked: linkedIds(message)
    });
    await message.setFlag(SYSTEM_ID, `applied.${index}`, "scheduled");
    return;
  }
  // Outside an encounter there are no rounds to wait for, so a delayed effect applies now.
  await applyEffect(row.effect, { ...p, round: p.combat?.encounterState.round });
  await message.setFlag(SYSTEM_ID, `applied.${index}`, true);
  if (row.effect.op === "momentum") await syncLinked(message);
}

/* -------------------------------------------- */
/*  Linked encounters                            */
/* -------------------------------------------- */

/** The other encounters this action's momentum changes also apply in. */
export function linkedIds(message) {
  return [...(message.getFlag(SYSTEM_ID, "linked") ?? [])];
}

/**
 * Open encounters the acting character or the target takes part in, other than the card's own:
 * the choices for linking. Each with the two combatants found in it.
 */
export function linkCandidates(message) {
  const p = participants(message);
  if (!p.ctx) return [];
  const out = [];
  for (const combat of game.combats) {
    if (combat.closed || combat === p.combat) continue;
    const actorCombatant = combatantOf(combat, p.actor);
    const targetCombatant = p.target && p.target !== p.actor ? combatantOf(combat, p.target) : null;
    if (actorCombatant || targetCombatant) out.push({ combat, actorCombatant, targetCombatant });
  }
  return out;
}

/**
 * Apply the action's momentum changes (its cost, once taken, and every momentum outcome already
 * applied) in each linked encounter that has not had them yet. Called when the links change and
 * after each momentum outcome is applied, so the order does not matter. GM side.
 */
export async function syncLinked(message) {
  const ids = linkedIds(message);
  if (!ids.length) return;
  const p = participants(message);
  const changes = actionMomentumChanges({
    cost: p.ctx?.action?.cost ?? 0,
    costSpent: Boolean(p.ctx?.costSpent),
    rows: relevantOutcomes(message),
    applied: message.getFlag(SYSTEM_ID, "applied") ?? {}
  });
  const encounters = ids.map((id) => game.combats.get(id)).filter((c) => c && !c.closed).map((combat) => ({
    combatId: combat.id,
    actorPid: combatantOf(combat, p.actor)?.id ?? null,
    targetPid: p.target && p.target !== p.actor ? combatantOf(combat, p.target)?.id ?? null : null
  }));
  const ledger = message.getFlag(SYSTEM_ID, "linkedApplied") ?? {};
  const ops = linkedMomentumOps({ changes, encounters, ledger });
  if (!ops.length) return;
  for (const op of ops) {
    const c = game.combats.get(op.combatId)?.combatants.get(op.pid);
    if (!c) continue;
    if (op.set != null) await c.setMomentum(op.set);
    else await c.adjustMomentum(op.delta);
    ledger[op.ledgerKey] = true;
  }
  await message.setFlag(SYSTEM_ID, "linkedApplied", ledger);
}

/** Set which encounters the action is linked to, then catch them up. */
export async function setLinked(message, ids) {
  await message.setFlag(SYSTEM_ID, "linked", [...new Set(ids)]);
  await syncLinked(message);
}

/**
 * The linking window: every open encounter the acting character or the target is in, with
 * their momentum there. Ticked encounters get this action's momentum changes too.
 */
export async function openLinkDialog(message) {
  const esc = foundry.utils.escapeHTML;
  const t = (k) => game.i18n.localize(k);
  const p = participants(message);
  const candidates = linkCandidates(message);
  const linked = new Set(linkedIds(message));
  const ledger = message.getFlag(SYSTEM_ID, "linkedApplied") ?? {};
  const who = (c) => (c ? `${esc(c.name)} <strong>${c.momentum}</strong>` : `<span class="hint">—</span>`);
  const rows = candidates.map(({ combat, actorCombatant, targetCombatant }) => {
    const applied = Object.keys(ledger).some((k) => k.startsWith(`${combat.id}:`));
    const labels = combat.labels.map((l) => `<span class="em-label">${esc(l)}</span>`).join("");
    return `<tr>
      <td><input type="checkbox" name="link" value="${combat.id}" ${linked.has(combat.id) ? "checked" : ""}></td>
      <td><strong>${esc(combat.label)}</strong> <span class="hint">${esc(t(`MODULUS.Encounter.Kind.${combat.kind}`))}</span> ${labels}${applied ? ` <i class="fa-solid fa-check" data-tooltip="MODULUS.Link.AppliedThere"></i>` : ""}</td>
      <td>${who(actorCombatant)}</td><td>${who(targetCombatant)}</td></tr>`;
  }).join("");
  const own = p.combat ? esc(p.combat.label) : esc(t("MODULUS.Link.NoEncounter"));
  const content = candidates.length
    ? `<p class="hint">${esc(game.i18n.format("MODULUS.Link.Hint", { own }))}</p>
      <table class="modulus-link-table"><tr><th></th><th>${t("MODULUS.Encounter.Instances")}</th><th>${esc(p.actor?.name ?? "")}</th><th>${esc(p.target && p.target !== p.actor ? p.target.name : t("MODULUS.Link.Target"))}</th></tr>${rows}</table>
      <p class="hint">${t("MODULUS.Link.NoUndo")}</p>`
    : `<p>${t("MODULUS.Link.None")}</p>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("MODULUS.Link.Title", { label: p.ctx?.label ?? "" }) },
    classes: ["modulus", "modulus-link-dialog"],
    position: { width: 560 },
    content,
    rejectClose: false,
    buttons: candidates.length ? [
      { action: "ok", label: "MODULUS.Link.Apply", icon: "fa-solid fa-link", default: true,
        callback: (e, b) => [...b.form.querySelectorAll("input[name=link]:checked")].map((i) => i.value) },
      { action: "cancel", label: "Cancel" }
    ] : [{ action: "cancel", label: "Close" }]
  });
  if (Array.isArray(result)) await setLinked(message, result);
}

/**
 * A delayed effect falls due: apply it now (auto-apply) or post it with an Apply button.
 * The card carries the same context as an outcome card, so the usual buttons work.
 */
export async function fireDelayed(combat, d, { autoApply = false } = {}) {
  const actor = combat.combatants.get(d.actorPid)?.actor ?? (d.actorUuid ? await fromUuid(d.actorUuid) : null);
  const target = combat.combatants.get(d.targetPid)?.actor ?? (d.targetUuid ? await fromUuid(d.targetUuid) : null);
  const context = {
    label: game.i18n.format("MODULUS.Delayed.Fires", { source: d.source }),
    encounter: { combatId: combat.id },
    actorPid: d.actorPid,
    targetPid: d.targetPid,
    targetUuid: target?.uuid ?? null,
    outcomeEffects: [{ trigger: "onResolve", source: d.source, effect: d.effect, text: d.text }],
    action: { onResolve: [] }
  };
  const content = `<div class="modulus-roll-card"><header><h3>${foundry.utils.escapeHTML(context.label)}</h3></header>
    <div class="roll-meta note">${foundry.utils.escapeHTML(game.i18n.format("MODULUS.Delayed.Scheduled", { round: d.scheduledRound }))}</div></div>`;
  const message = await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: combat.label },
    content,
    flags: { [SYSTEM_ID]: { context, linked: d.linked ?? [] } }
  });
  if (autoApply && message) await applyOutcome(message, 0);
  return message;
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
  decorateLinks(message, html);
  const rows = relevantOutcomes(message);
  if (!rows.length) return;
  const applied = message.getFlag(SYSTEM_ID, "applied") ?? {};
  const list = document.createElement("ul");
  list.className = "modulus-outcomes";
  for (const r of rows) {
    const li = document.createElement("li");
    const done = applied[r.index];
    const scheduled = done === "scheduled";
    li.className = done ? (scheduled ? "scheduled" : "applied") : "";
    li.innerHTML = `<span>${foundry.utils.escapeHTML(r.text)}</span>${scheduled ? ` <span class="note">${game.i18n.localize("MODULUS.Delayed.Pending")}</span>` : ""}`;
    if (game.user.isGM) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "outcome-apply";
      b.disabled = Boolean(done);
      b.innerHTML = done ? `<i class="fa-solid ${scheduled ? "fa-hourglass-half" : "fa-check"}"></i>`
        : `<i class="fa-solid ${r.effect.delay ? "fa-hourglass-start" : "fa-play"}"></i> ${game.i18n.localize(r.effect.delay ? "MODULUS.Delayed.Schedule" : "MODULUS.Outcome.Apply")}`;
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

/**
 * The linked-encounters line on an action card: which other encounters its momentum changes
 * apply in, and for the GM the button that opens the linking window.
 */
function decorateLinks(message, html) {
  const ctx = messageContext(message);
  if (!ctx?.action) return;
  const names = linkedIds(message).map((id) => game.combats.get(id)?.label).filter(Boolean);
  if (!names.length && !game.user.isGM) return;
  const card = html.querySelector(".modulus-roll-card") ?? html;
  const bar = document.createElement("div");
  bar.className = "modulus-link-bar";
  const text = names.length
    ? `${game.i18n.localize("MODULUS.Link.AlsoIn")} ${names.map((n) => foundry.utils.escapeHTML(n)).join(", ")}`
    : `<span class="hint">${game.i18n.localize("MODULUS.Link.NotLinked")}</span>`;
  bar.innerHTML = `<i class="fa-solid fa-link"></i> <span>${text}</span>`;
  if (game.user.isGM) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link-encounters";
    b.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${game.i18n.localize("MODULUS.Link.Open")}`;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      openLinkDialog(message);
    });
    bar.append(b);
  }
  card.append(bar);
}
