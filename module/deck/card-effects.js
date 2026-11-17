/**
 * Reads card-related effects off an actor's items (§10).
 *
 * Effect ops (authored in an item's `effects` array):
 *   { "op": "deckModify", "args": { "remove": {...} } | { "add": {...} } }   composition, applied at deck creation
 *   { "op": "draw",       "args": { "count": 1 } }                          draw cards when the action resolves
 *   { "op": "pokerHand",  "args": { "minRank": 1, "consume": "selected", "scaling": [...], "grant": {...} } }
 *   { "op": "deckMark",   "args": { "target": {...selector}, "mark": { "type": "burn" } } }   marks applied at deck creation
 *   { "op": "cardMark",   "args": { "mark": {...}, "count": 1, "uses": 1 } }                  mark chosen cards mid-encounter
 * See docs/CARD_DECK.md for the full format.
 */
export const CARD_OPS = Object.freeze(["deckModify", "deckMark", "draw", "pokerHand", "cardMark"]);
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

/** Deck-build marks: [{ target, mark }]. */
export function deckMarks(actor) {
  const out = [];
  for (const { effect } of actorEffects(actor)) {
    if (effect.op === "deckMark" && effect.args?.mark) out.push({ target: effect.args.target ?? {}, mark: effect.args.mark });
  }
  return out;
}

/**
 * Abilities that put a mark on chosen cards during an encounter.
 * `count` = cards per use (default 1); `uses` = uses per encounter (default 1, 0 = unlimited).
 */
export function markAbilities(actor) {
  const out = [];
  for (const { item, effect, index } of actorEffects(actor)) {
    if (effect.op !== "cardMark" || !effect.args?.mark) continue;
    const a = effect.args;
    out.push({
      item, index,
      key: `${item.id}:${index}`,
      label: a.label || item.name,
      mark: a.mark,
      count: Math.max(1, a.count ?? 1),
      uses: Math.max(0, a.uses ?? 1)
    });
  }
  return out;
}
