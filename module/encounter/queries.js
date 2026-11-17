/**
 * GM <-> player request/response (§14) on Foundry's user queries. The GM's controller sends
 * these; the player's client opens a dialog and returns the choice. Players never change
 * encounter state themselves.
 */
import { SYSTEM_ID } from "../config.js";
import { ActionBuilder } from "../apps/action-builder.js";
import { resolutionOrder } from "../rules/encounter.js";

const { DialogV2 } = foundry.applications.api;

function lookup({ combatId, combatantId }) {
  const combat = game.combats.get(combatId);
  const combatant = combat?.combatants.get(combatantId);
  return { combat, combatant, actor: combatant?.actor };
}

async function participation({ combatId, combatantIds }) {
  const combat = game.combats.get(combatId);
  if (!combat) return null;
  const t = (k) => game.i18n.localize(k);
  const tracks = { "": "—", physical: t("MODULUS.Domain.physical"), mental: t("MODULUS.Domain.mental"), social: t("MODULUS.Domain.social") };
  const rows = combatantIds.map((id) => combat.combatants.get(id)).filter(Boolean).map((c) => `
    <tr>
      <td><label><input type="checkbox" name="${c.id}.active" ${c.participating ? "checked" : ""}> ${foundry.utils.escapeHTML(c.name)}</label></td>
      <td><input type="number" name="${c.id}.momentum" value="${c.momentum}" step="1"></td>
      <td><select name="${c.id}.sceneTrack">${Object.entries(tracks).map(([k, v]) => `<option value="${k}" ${c.sceneTrack === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
    </tr>`).join("");
  const content = `<p>${game.i18n.format("MODULUS.Encounter.ParticipationHint", { name: foundry.utils.escapeHTML(combat.label), round: combat.encounterState.round })}</p>
    <table class="modulus-participation"><thead><tr><th></th><th>${t("MODULUS.Sheet.Momentum")}</th><th>${t("MODULUS.Builder.SceneTrack")}</th></tr></thead><tbody>${rows}</tbody></table>`;
  return DialogV2.wait({
    window: { title: "MODULUS.Encounter.Participation" },
    classes: ["modulus"],
    content,
    rejectClose: false,
    buttons: [{
      action: "ok",
      label: "MODULUS.Encounter.TakePart",
      default: true,
      callback: (event, button) => {
        const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(button.form).object);
        return Object.fromEntries(Object.entries(data).map(([id, v]) => [id, { active: Boolean(v.active), momentum: Math.trunc(Number(v.momentum)), sceneTrack: v.sceneTrack }]));
      }
    }]
  });
}

async function declare(data) {
  const { combat, combatant, actor } = lookup(data);
  if (!actor) return null;
  return ActionBuilder.prompt(actor, { mode: "declare", combat, combatant, prefill: data.prefill ?? null, note: data.note ?? "" });
}

async function reconfirm(data) {
  const { combat, combatant, actor } = lookup(data);
  if (!actor) return null;
  return ActionBuilder.prompt(actor, {
    mode: "reconfirm",
    combat,
    combatant,
    prefill: data.prefill,
    note: game.i18n.format("MODULUS.Encounter.ReconfirmNote", { cause: data.cause })
  });
}

async function duelist(data) {
  const { combat, combatant } = lookup(data);
  if (!combatant) return null;
  const state = combat.encounterState;
  const stack = resolutionOrder(state).map((e) => `<li>${e.id === data.entryId ? "<strong>" : ""}${foundry.utils.escapeHTML(e.name)}: ${foundry.utils.escapeHTML(e.decl.label)} (${e.effective})${e.id === data.entryId ? "</strong>" : ""}</li>`).join("");
  return DialogV2.wait({
    window: { title: "MODULUS.Encounter.Duelist" },
    classes: ["modulus"],
    content: `<p>${game.i18n.format("MODULUS.Encounter.DuelistHint", { max: data.max })}</p><ol class="modulus-stack-mini">${stack}</ol>
      <div class="form-group"><label>${game.i18n.localize("MODULUS.Encounter.DuelistDrop")}</label><input type="number" name="drop" value="0" min="0" max="${data.max}" step="1"></div>`,
    rejectClose: false,
    buttons: [{
      action: "ok",
      label: "MODULUS.Encounter.Confirm",
      default: true,
      callback: (event, button) => ({ drop: Math.trunc(Number(button.form.elements.drop.value) || 0) })
    }]
  });
}

/** GM side: a player without update permission on their combatant asks the GM to set momentum. */
async function setMomentum({ combatId, combatantId, value }, { user }) {
  if (!game.user.isGM) return false;
  const c = game.combats.get(combatId)?.combatants.get(combatantId);
  if (!c?.actor?.testUserPermission(user, "OWNER")) return false;
  await c.update({ [`flags.${SYSTEM_ID}.momentum`]: value, initiative: value });
  return true;
}

export function registerQueries() {
  Object.assign(CONFIG.queries, {
    [`${SYSTEM_ID}.participation`]: participation,
    [`${SYSTEM_ID}.declare`]: declare,
    [`${SYSTEM_ID}.reconfirm`]: reconfirm,
    [`${SYSTEM_ID}.duelist`]: duelist,
    [`${SYSTEM_ID}.setMomentum`]: setMomentum
  });
}
