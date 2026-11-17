/**
 * Turn a player's declaration payload (uuids + target) into what the stack engine needs.
 * Runs on the GM client so the GM's copy of the rules decides; players only send choices.
 */
import { buildDeclaration, toStackDeclaration } from "../apps/action-builder.js";

/** Resolve uuids to Items. Accepts world, compendium and embedded Items. */
export async function loadItems(payload) {
  const action = payload?.actionUuid ? await fromUuid(payload.actionUuid) : null;
  const words = [];
  for (const u of payload?.wordUuids ?? []) {
    const w = await fromUuid(u);
    if (w) words.push(w);
  }
  return { action, words };
}

/** Target actor and mode for a payload target within a combat. */
export function targetFor(combat, target) {
  if (!target || target.kind === "none") return { mode: "none", actor: null };
  if (target.kind === "self") return { mode: "self", actor: null };
  if (target.kind === "actor") return { mode: "target", actor: combat.combatants.get(target.pid)?.actor ?? null };
  if (target.kind === "entry") return { mode: "entry", actor: null };
  return { mode: "none", actor: null };
}

/**
 * @returns {Promise<{decl, plan, errors: string[]}>}
 */
export async function declarationFromPayload(combat, combatant, payload, { momentum = combatant.momentum, extraDice, extraFlat } = {}) {
  const { action, words } = await loadItems(payload);
  if (!action) return { decl: null, plan: null, errors: [game.i18n.localize("MODULUS.Encounter.Error.noAction")] };
  const target = targetFor(combat, payload.target);
  const plan = buildDeclaration(combatant.actor, {
    action, words, target: target.actor, targetMode: target.mode,
    sceneTrack: combatant.sceneTrack || payload.sceneTrack || undefined,
    momentum, extraDice, extraFlat
  });
  const errors = plan.assembled.errors.map((e) => game.i18n.format(`MODULUS.Builder.Error.${e.code}`, e));
  return { decl: toStackDeclaration(plan, { payload, target: payload.target ?? { kind: "none" } }), plan, errors };
}
