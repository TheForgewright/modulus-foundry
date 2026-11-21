/**
 * Finding a character's encounters (§7.1, §7.11). Every Combat in the world is an encounter
 * instance; a character can be in many at once. No document classes here, so rules-side and
 * chat code can import it without Foundry's Combat class loaded.
 */

/** The combatant standing for this actor in a combat (its token's, or the world actor's). */
export function combatantOf(combat, actor) {
  if (!combat || !actor) return null;
  return combat.combatants.find((c) => c.actor === actor)
    ?? (actor.isToken || !actor.id ? null : combat.combatants.find((c) => c.actorId === actor.id))
    ?? null;
}

/**
 * Encounters an actor takes part in, with its combatant in each. Every Combat in the world
 * counts, not only the tracker's. Closed extended encounters are left out unless asked for.
 */
export function encountersOf(actor, { closed = false } = {}) {
  const out = [];
  if (!actor) return out;
  for (const combat of game.combats) {
    if (combat.closed && !closed) continue;
    const combatant = combatantOf(combat, actor);
    if (combatant) out.push({ combat, combatant });
  }
  return out;
}

/** The character's open relationships, in the shape roomEntryMomentum takes. */
export function relationshipsOf(actor, { except = null } = {}) {
  return encountersOf(actor)
    .filter(({ combat }) => combat.kind === "relationship" && combat.id !== except)
    .map(({ combat, combatant }) => ({
      id: combat.id,
      momentum: combatant.momentum,
      counterparts: combat.combatants.filter((c) => c !== combatant && c.actorId).map((c) => c.actorId)
    }));
}
