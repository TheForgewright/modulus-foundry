/**
 * Personal card deck (§10). Pure JS, no Foundry imports.
 *
 * Cards are plain objects { id, rank, suit, marks }:
 *   rank 2..14 (11 J, 12 Q, 13 K, 14 A), suit "c" | "d" | "h" | "s"
 *   jokers: rank 0, suit "x"
 * Ids are "<rank><suit>" ("Ah", "Tc", "X") with a "#n" suffix for duplicates.
 * `marks` are special effects that fire when the card is used in a hand (see MARK_TYPES).
 *
 * Deck state (one per character per encounter):
 *   { draw: Card[], hand: Card[], discard: Card[], burned: Card[], reshuffles: number }
 * The top of the draw pile is the END of the array.
 */

export const SUITS = Object.freeze(["c", "d", "h", "s"]);
export const SUIT_NAMES = Object.freeze({ c: "clubs", d: "diamonds", h: "hearts", s: "spades", x: "joker" });
export const RANKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
export const NUMBER_RANKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const FACE_RANKS = Object.freeze([11, 12, 13]);
const RANK_CHAR = { 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A" };

/** Standard hand categories as integers (higher is better). */
export const HAND_RANKS = Object.freeze({
  highCard: 0,
  pair: 1,
  twoPair: 2,
  threeOfAKind: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  fourOfAKind: 7,
  straightFlush: 8,
  royalFlush: 9,
  fiveOfAKind: 10
});
export const HAND_NAMES = Object.freeze(Object.fromEntries(Object.entries(HAND_RANKS).map(([k, v]) => [v, k])));

export const MAX_HAND_SIZE = 5;

/* -------------------------------------------- */
/*  Cards                                        */
/* -------------------------------------------- */

export function cardCode(rank, suit) {
  if (rank === 0) return "X";
  return `${RANK_CHAR[rank] ?? rank}${suit}`;
}

export function isJoker(card) {
  return card.rank === 0;
}

/** Parse a card code ("Ah", "10c", "Tc", "X"/"joker") into { rank, suit }. */
export function parseCard(code) {
  const s = String(code).trim();
  if (/^(x|joker)$/i.test(s)) return { rank: 0, suit: "x" };
  const m = s.match(/^(10|[2-9TJQKA])([cdhs])$/i);
  if (!m) throw new Error(`Invalid card: ${code}`);
  const r = m[1].toUpperCase();
  const rank = { T: 10, "10": 10, J: 11, Q: 12, K: 13, A: 14 }[r] ?? Number(r);
  return { rank, suit: m[2].toLowerCase() };
}

/** Assign unique ids, suffixing duplicates. */
function withIds(cards) {
  const seen = new Map();
  return cards.map(({ rank, suit, marks }) => {
    const base = cardCode(rank, suit);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}#${n}`, rank, suit, marks: marks ?? [] };
  });
}

export function standardDeck() {
  return withIds(SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))));
}

/* -------------------------------------------- */
/*  Composition                                  */
/* -------------------------------------------- */

function expandRanks(ranks) {
  if (ranks === "number") return NUMBER_RANKS;
  if (ranks === "face") return FACE_RANKS;
  if (ranks === "all" || ranks == null) return RANKS;
  const list = Array.isArray(ranks) ? ranks : [ranks];
  return list.map((r) => (typeof r === "number" ? r : parseCard(`${r}c`).rank));
}

function expandSuits(suit) {
  if (suit == null || suit === "all") return SUITS;
  return Array.isArray(suit) ? suit : [suit];
}

/**
 * Build a deck from the standard 52 plus composition modifiers collected from the
 * owner's effects. Each modifier is one of:
 *   { remove: { suit?: "h" | ["h","d"] | "all", ranks?: "number" | "face" | "all" | [2, "K", ...] } }
 *   { remove: { cards: ["Ah", "X"] } }        remove specific cards (one copy each)
 *   { add: { cards: ["X", "X", "As"] } }      add specific cards (duplicates allowed)
 *   { add: { jokers: n } }
 * Removals apply before additions, so an ability can never strip a card another ability added.
 * @returns {{cards: Card[], applied: object[]}}
 */
export function buildDeck(modifiers = []) {
  let cards = standardDeck().map(({ rank, suit }) => ({ rank, suit }));
  const removes = modifiers.filter((m) => m?.remove);
  const adds = modifiers.filter((m) => m?.add);
  for (const { remove } of removes) {
    if (remove.cards) {
      for (const code of remove.cards) {
        const { rank, suit } = parseCard(code);
        const i = cards.findIndex((c) => c.rank === rank && c.suit === suit);
        if (i >= 0) cards.splice(i, 1);
      }
    } else {
      const suits = expandSuits(remove.suit);
      const ranks = expandRanks(remove.ranks);
      cards = cards.filter((c) => !(suits.includes(c.suit) && ranks.includes(c.rank)));
    }
  }
  for (const { add } of adds) {
    for (const code of add.cards ?? []) cards.push(parseCard(code));
    for (let i = 0; i < (add.jokers ?? 0); i++) cards.push({ rank: 0, suit: "x" });
  }
  return { cards: withIds(cards), applied: [...removes, ...adds] };
}

/* -------------------------------------------- */
/*  Deck state                                   */
/* -------------------------------------------- */

export function shuffle(cards, rng = Math.random) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* -------------------------------------------- */
/*  Marks                                        */
/* -------------------------------------------- */

/**
 * Mark types. A mark is { type, value, consumable, label? } on a card. Marks fire when
 * the card is part of a hand that an ability uses:
 *   burn    every card in that hand is burned (gone for the encounter) instead of going to the used pile
 *   draw    draw `value` cards afterwards; value 0 = as many cards as the hand contained
 *   rankUp  the hand counts `value` ranks higher (default 1), capped at five of a kind
 * A consumable mark is removed from its card after it fires, for the rest of the encounter.
 *
 * Each mark type applies at most once per hand (see resolveMarks).
 */
export const MARK_TYPES = Object.freeze(["burn", "draw", "rankUp"]);

export function normalizeMark(mark = {}) {
  if (!MARK_TYPES.includes(mark.type)) throw new Error(`Unknown mark type: ${mark.type}`);
  const value = Math.max(0, Math.floor(Number(mark.value ?? (mark.type === "rankUp" ? 1 : 0)) || 0));
  const out = { type: mark.type, value, consumable: Boolean(mark.consumable) };
  if (mark.label) out.label = String(mark.label);
  return out;
}

/**
 * Does a card match a selector? Selectors:
 *   { cards: ["2h", "X"] }                       specific cards (every copy)
 *   { suit: "h" | ["h","d"] | "all", ranks: "number" | "face" | "all" | [2, "K"] }
 */
export function matchesSelector(card, sel = {}) {
  if (sel.cards) {
    return sel.cards.some((code) => {
      const { rank, suit } = parseCard(code);
      return card.rank === rank && card.suit === suit;
    });
  }
  if (isJoker(card)) return false; // jokers are only matched by code
  return expandSuits(sel.suit).includes(card.suit) && expandRanks(sel.ranks).includes(card.rank);
}

/**
 * Decide which marks fire for a hand. Each mark type applies once per hand, however
 * many cards carry it. The first copy, in the order the player picked the cards (then
 * the order marks were added to a card), is the one used: its value applies, and it is
 * exhausted if it is consumable. Other copies are untouched.
 * @param {Card[]} cards  in selection order
 * @returns {Array<{type, value, consumable, cardId, markIndex, exhaust}>} one entry per type present
 */
export function resolveMarks(cards) {
  const byType = new Map();
  cards.forEach((card) => (card.marks ?? []).forEach((m, markIndex) => {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type).push({ ...m, cardId: card.id, markIndex });
  }));
  const out = [];
  for (const type of MARK_TYPES) {
    const copies = byType.get(type);
    if (!copies) continue;
    out.push({ ...copies[0], exhaust: copies[0].consumable });
  }
  return out;
}

function withMark(card, mark) {
  return { ...card, marks: [...(card.marks ?? []), normalizeMark(mark)] };
}

/**
 * Apply deck-build marks: [{ target: selector, mark: {...} }]. Marks every matching card.
 */
export function applyDeckMarks(cards, markDefs = []) {
  return cards.map((card) => {
    let c = card;
    for (const def of markDefs) if (def?.mark && matchesSelector(card, def.target)) c = withMark(c, def.mark);
    return c;
  });
}

/** Put a mark on specific cards wherever they are (hand, draw pile or used pile). */
export function markCards(state, ids, mark) {
  const s = clone(state);
  const set = new Set(ids);
  for (const pile of ["hand", "draw", "discard"]) s[pile] = s[pile].map((c) => (set.has(c.id) ? withMark(c, mark) : c));
  return s;
}

/** New deck state, shuffled once (§10). */
export function createDeckState(modifiers = [], rng = Math.random, markDefs = []) {
  const { cards } = buildDeck(modifiers);
  const marked = applyDeckMarks(cards, markDefs);
  return { draw: shuffle(marked, rng), hand: [], discard: [], burned: [], reshuffles: 0, size: cards.length, markUses: {} };
}

function clone(state) {
  return {
    ...state,
    draw: [...state.draw],
    hand: [...state.hand],
    discard: [...state.discard],
    burned: [...state.burned]
  };
}

/**
 * Draw `count` cards into the hand. If the draw pile runs dry mid-draw, the discard
 * pile (cards already used) is shuffled into a new draw pile. Burned cards never return.
 * @returns {{state, drawn: Card[], short: number, reshuffled: number}}
 *   `short` is how many cards could not be drawn because nothing was left.
 */
export function drawCards(state, count, rng = Math.random) {
  const s = clone(state);
  const drawn = [];
  let reshuffled = 0;
  for (let i = 0; i < count; i++) {
    if (!s.draw.length && s.discard.length) {
      s.draw = shuffle(s.discard, rng);
      s.discard = [];
      s.reshuffles++;
      reshuffled++;
    }
    if (!s.draw.length) break;
    const card = s.draw.pop();
    s.hand.push(card);
    drawn.push(card);
  }
  return { state: s, drawn, short: count - drawn.length, reshuffled };
}

function takeFromHand(s, ids) {
  const set = new Set(ids);
  const taken = s.hand.filter((c) => set.has(c.id));
  if (taken.length !== set.size) throw new Error("Card not in hand");
  s.hand = s.hand.filter((c) => !set.has(c.id));
  return taken;
}

/** Move cards from hand to the discard pile (they can be reshuffled later). */
export function discardCards(state, ids) {
  const s = clone(state);
  s.discard.push(...takeFromHand(s, ids));
  return s;
}

/** Burn (§10): the card leaves the deck for the rest of the encounter. Works on hand or draw pile cards. */
export function burnCards(state, ids) {
  const s = clone(state);
  const set = new Set(ids);
  for (const pile of ["hand", "draw", "discard"]) {
    const keep = [];
    for (const c of s[pile]) (set.has(c.id) ? s.burned : keep).push(c);
    s[pile] = keep;
  }
  return s;
}

/* -------------------------------------------- */
/*  Blackjack value (discard for momentum)       */
/* -------------------------------------------- */

/**
 * Blackjack value of a card (§10): 2-10 face value, J/Q/K 10, Ace 1 or 11 (chosen).
 * Jokers have no defined value [OPEN] and return null.
 */
export function blackjackValue(card, { aceHigh = false } = {}) {
  if (isJoker(card)) return null;
  if (card.rank === 14) return aceHigh ? 11 : 1;
  return Math.min(10, card.rank);
}

/* -------------------------------------------- */
/*  Poker hand evaluation                        */
/* -------------------------------------------- */

/** Evaluate 1-5 natural (non-joker) cards. Returns a score array, compared lexicographically. */
function evaluateNatural(cards) {
  const counts = new Map();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // Groups sorted by size, then rank, descending.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sizes = groups.map((g) => g[1]);
  const byGroup = groups.map((g) => g[0]);
  const five = cards.length === 5;
  const flush = five && cards.every((c) => c.suit === cards[0].suit);
  let straightHigh = 0;
  if (five && groups.length === 5) {
    const r = byGroup.slice().sort((a, b) => b - a);
    if (r[0] - r[4] === 4) straightHigh = r[0];
    else if (r[0] === 14 && r[1] === 5 && r[4] === 2) straightHigh = 5; // A-2-3-4-5, ace low
  }
  const H = HAND_RANKS;
  if (sizes[0] === 5) return [H.fiveOfAKind, byGroup[0]];
  if (straightHigh && flush) return [straightHigh === 14 ? H.royalFlush : H.straightFlush, straightHigh];
  if (sizes[0] === 4) return [H.fourOfAKind, ...byGroup];
  if (sizes[0] === 3 && sizes[1] === 2) return [H.fullHouse, ...byGroup];
  if (flush) return [H.flush, ...byGroup];
  if (straightHigh) return [H.straight, straightHigh];
  if (sizes[0] === 3) return [H.threeOfAKind, ...byGroup];
  if (sizes[0] === 2 && sizes[1] === 2) return [H.twoPair, ...byGroup];
  if (sizes[0] === 2) return [H.pair, ...byGroup];
  return [H.highCard, ...byGroup];
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

const ALL_FACES = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));

/**
 * Evaluate the best poker hand from up to 5 selected cards. Jokers are wild:
 * each joker becomes whichever card gives the best result (duplicates allowed,
 * so five of a kind is possible). Aces are high or low. `rankUp` marks on the
 * cards raise the result once per hand (resolveMarks), capped at five of a kind.
 * @returns {{rank, name, baseRank, baseName, rankUp, score, cards, size}|null}
 *   `rank` is the HAND_RANKS integer the hand counts as; `baseRank` is what the cards
 *   actually make. `score` is the tie-break array with the counted rank first.
 *   null for an empty selection.
 */
export function evaluateHand(cards) {
  if (!cards?.length) return null;
  if (cards.length > MAX_HAND_SIZE) throw new Error(`A poker hand has at most ${MAX_HAND_SIZE} cards`);
  const natural = cards.filter((c) => !isJoker(c));
  const jokers = cards.length - natural.length;
  let best = null;
  const search = (chosen, left) => {
    if (left === 0) {
      const score = evaluateNatural([...natural, ...chosen]);
      if (!best || compareScores(score, best) > 0) best = score;
      return;
    }
    for (const f of ALL_FACES) search([...chosen, f], left - 1);
  };
  search([], jokers);
  const rankUpMark = resolveMarks(cards).find((m) => m.type === "rankUp");
  const rankUp = rankUpMark ? rankUpMark.value ?? 1 : 0;
  const baseRank = best[0];
  const rank = Math.min(HAND_RANKS.fiveOfAKind, baseRank + rankUp);
  return {
    rank,
    name: HAND_NAMES[rank],
    baseRank,
    baseName: HAND_NAMES[baseRank],
    rankUp: rank - baseRank,
    score: [rank, ...best],
    cards: [...cards],
    size: cards.length
  };
}

/* -------------------------------------------- */
/*  Using hands with abilities                   */
/* -------------------------------------------- */

/**
 * A poker-hand requirement as authored on an effect (op "pokerHand"):
 *   {
 *     minRank: 1,                         // minimum HAND_RANKS integer (default 0)
 *     consume: "selected" | "hand" | "none",
 *                                         // selected = spend the cards used; hand = discard the whole hand
 *                                         // (§10 cash-in default); none = only checks (a requirement)
 *     scaling: [ { minRank: 1, buff: 1 }, { minRank: 4, buff: 2 } ]
 *                                         // optional: the highest row whose minRank is met is granted
 *   }
 * The effect menu per hand rank is content and [OPEN #26]; the engine only evaluates.
 */
export function checkHandRequirement(hand, req = {}) {
  const minRank = req.minRank ?? 0;
  if (!hand) return { ok: false, reason: "noCards", grant: null };
  if (hand.rank < minRank) return { ok: false, reason: "tooWeak", grant: null };
  const rows = (req.scaling ?? []).filter((r) => hand.rank >= (r.minRank ?? 0));
  const grant = rows.sort((a, b) => (b.minRank ?? 0) - (a.minRank ?? 0))[0] ?? null;
  return { ok: true, reason: null, grant };
}

/**
 * Spend a hand for an ability. Evaluates the selected cards (rankUp marks included),
 * checks the requirement, moves cards per `consume`, then fires the played cards' marks:
 *   burn  -> the played cards are burned instead of going to the used pile
 *   draw  -> draw afterwards (value 0 = as many as were played); may reshuffle the used pile
 * Each mark type fires once per hand; at most one consumable copy is exhausted (resolveMarks).
 * With consume "none" nothing is spent, so burn and draw marks do not fire and nothing is
 * stripped; rankUp still counts toward the hand.
 * @returns {{ok, reason, hand, grant, state, burned: Card[], drawn: Card[], drawShort: number,
 *            reshuffled: number, marksFired: object[]}}
 */
export function useHand(state, selectedIds, req = {}, rng = Math.random) {
  const selected = selectedIds.map((id) => state.hand.find((c) => c.id === id));
  if (selected.some((c) => !c)) throw new Error("Card not in hand");
  const hand = selected.length ? evaluateHand(selected) : null;
  const check = checkHandRequirement(hand, req);
  const empty = { burned: [], drawn: [], drawShort: 0, reshuffled: 0, marksFired: [] };
  if (!check.ok) return { ...check, hand, state, ...empty };
  const consume = req.consume ?? "selected";
  if (consume === "none") return { ...check, hand, state, ...empty };

  // Which marks fire (once per type), and strip the single exhausted copy of each.
  const marksFired = resolveMarks(selected);
  const played = selected.map((card) => {
    const drop = new Set(marksFired.filter((m) => m.exhaust && m.cardId === card.id).map((m) => m.markIndex));
    return drop.size ? { ...card, marks: card.marks.filter((_, i) => !drop.has(i)) } : card;
  });
  const burn = marksFired.some((m) => m.type === "burn");

  let s = clone(state);
  const playedIds = new Set(selectedIds);
  const others = consume === "hand" ? s.hand.filter((c) => !playedIds.has(c.id)) : [];
  s.hand = consume === "hand" ? [] : s.hand.filter((c) => !playedIds.has(c.id));
  s.discard.push(...others);
  if (burn) s.burned.push(...played);
  else s.discard.push(...played);

  let drawCount = 0;
  for (const m of marksFired) if (m.type === "draw") drawCount = m.value > 0 ? m.value : selected.length;
  let drawn = [];
  let drawShort = 0;
  let reshuffled = 0;
  if (drawCount) {
    const r = drawCards(s, drawCount, rng);
    s = r.state;
    drawn = r.drawn;
    drawShort = r.short;
    reshuffled = r.reshuffled;
  }
  return { ...check, hand, state: s, burned: burn ? played : [], drawn, drawShort, reshuffled, marksFired };
}
