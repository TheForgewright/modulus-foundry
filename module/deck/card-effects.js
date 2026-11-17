/**
 * Reads card-related effects off an actor's items (§10).
 *
 * Effect ops (authored in an item's `effects` array):
 *   { "op": "deckModify", "args": { "remove": {...} } | { "add": {...} } }   composition, applied at deck creation
 *   { "op": "draw",       "args": { "count": 1 } }                          draw cards when the action resolves
 *   { "op": "pokerHand",  "args": { "minRank": 1, "consume": "selected", "scaling": [...], "grant": {...} } }
 * See docs/CARD_DECK.md for the full format.
 */
export const CARD_OPS = Object.freeze(["deckModify", "draw", "pokerHand"]);
export const CARD_TAGS = Object.freeze(["draw", "cashout"]);

function* actorEffects(actor) {
  for (const item of actor.items) {
    const effects = item.system.effects ?? [];
    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index];
      if (effect && typeof effect === "object") yield { item, effect, index };
    }
  }
}

/** True if the actor owns anything that interacts with cards. Only these characters get a deck. */
export function hasCardAbilities(actor) {
  for (const { effect } of actorEffects(actor)) if (CARD_OPS.includes(effect.op)) return true;
  return actor.items.some((i) => (i.system.tags ?? []).some((t) => CARD_TAGS.includes(t.name)));
}

/** Composition modifiers from every owned item, in item sort order. */
export function deckModifiers(actor) {
  const mods = [];
  for (const { effect } of actorEffects(actor)) {
    if (effect.op === "deckModify" && effect.args) mods.push(effect.args);
  }
  return mods;
}

/** Abilities that use a poker hand, for the Cards tab. */
export function cardAbilities(actor) {
  const out = [];
  for (const { item, effect, index } of actorEffects(actor)) {
    if (effect.op !== "pokerHand") continue;
    out.push({ item, index, label: effect.args?.label || item.name, req: effect.args ?? {} });
  }
  return out;
}
