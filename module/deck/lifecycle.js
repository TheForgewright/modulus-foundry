/**
 * Deck lifecycle (§10). A personal deck is created for each participant with a
 * card ability when an encounter starts, and removed when the encounter is deleted.
 * Only the active GM performs these writes.
 */
import { getSetting } from "../settings.js";
import { hasCardAbilities } from "./card-effects.js";

const isActiveGM = () => game.users.activeGM?.isSelf;

async function ensureDeck(combat, actor) {
  if (!actor || !getSetting("enableDeck") || !hasCardAbilities(actor)) return;
  if (actor.getDeck(combat.id)) return;
  await actor.createDeck(combat.id);
}

export function registerDeckHooks() {
  Hooks.on("combatStart", async (combat) => {
    if (!isActiveGM()) return;
    for (const c of combat.combatants) await ensureDeck(combat, c.actor);
  });

  Hooks.on("createCombatant", async (combatant) => {
    if (!isActiveGM() || !combatant.parent?.started) return;
    await ensureDeck(combatant.parent, combatant.actor);
  });

  // Discard-for-momentum: the momentum gained is lost again at the start of the next round.
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!isActiveGM() || !("round" in changed)) return;
    for (const c of combat.combatants) {
      const deck = c.actor?.getDeck(combat.id);
      if (deck?.pendingMomentumLoss) await c.actor.settleMomentumLoss(combat.id);
    }
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!isActiveGM()) return;
    for (const actor of game.actors) {
      if (actor.getDeck(combat.id)) await actor.deleteDeck(combat.id);
    }
    // Unlinked token actors.
    for (const c of combat.combatants) {
      if (c.actor && !c.actor.isToken) continue;
      if (c.actor?.getDeck(combat.id)) await c.actor.deleteDeck(combat.id);
    }
  });
}
