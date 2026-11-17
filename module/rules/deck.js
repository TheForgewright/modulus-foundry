/**
 * Personal card deck (§10). Pure JS, no Foundry imports.
 *
 * Cards are plain objects { id, rank, suit }:
 *   rank 2..14 (11 J, 12 Q, 13 K, 14 A), suit "c" | "d" | "h" | "s"
 *   jokers: rank 0, suit "x"
 * Ids are "<rank><suit>" ("Ah", "Tc", "X") with a "#n" suffix for duplicates.
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
  return cards.map(({ rank, suit }) => {
    const base = cardCode(rank, suit);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}#${n}`, rank, suit };
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

/** New deck state, shuffled once (§10). */
export function createDeckState(modifiers = [], rng = Math.random) {
  const { cards } = buildDeck(modifiers);
  return { draw: shuffle(cards, rng), hand: [], discard: [], burned: [], reshuffles: 0, size: cards.length };
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
 * so five of a kind is possible). Aces are high or low.
 * @returns {{rank: number, name: string, score: number[], cards: Card[], size: number}|null}
 *   `rank` is the HAND_RANKS integer. null for an empty selection.
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
  return { rank: best[0], name: HAND_NAMES[best[0]], score: best, cards: [...cards], size: cards.length };
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
 * Spend a hand for an ability. Evaluates the selected cards, checks the requirement,
 * and moves cards to the discard pile per `consume`.
 * @returns {{ok, reason, hand, grant, state}}  state is unchanged when !ok or consume = "none".
 */
export function useHand(state, selectedIds, req = {}) {
  const selected = selectedIds.map((id) => state.hand.find((c) => c.id === id));
  if (selected.some((c) => !c)) throw new Error("Card not in hand");
  const hand = selected.length ? evaluateHand(selected) : null;
  const check = checkHandRequirement(hand, req);
  if (!check.ok) return { ...check, hand, state };
  const consume = req.consume ?? "selected";
  let next = state;
  if (consume === "selected") next = discardCards(state, selectedIds);
  else if (consume === "hand") next = discardCards(state, state.hand.map((c) => c.id));
  return { ...check, hand, state: next };
}
