// Personal card deck (§10).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  standardDeck, buildDeck, createDeckState, drawCards, discardCards, burnCards, parseCard,
  evaluateHand, HAND_RANKS as H, compareScores, blackjackValue, useHand, checkHandRequirement
} from "../module/rules/deck.js";

const hand = (...codes) => codes.map((c, i) => ({ id: `${c}-${i}`, ...parseCard(c) }));
const rank = (...codes) => evaluateHand(hand(...codes)).rank;

/** Deterministic RNG. */
function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

test("standard deck has 52 unique cards", () => {
  const d = standardDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.id)).size, 52);
});

test("composition: remove a suit's number cards, a suit's face cards, add jokers", () => {
  const { cards } = buildDeck([
    { remove: { suit: "h", ranks: "number" } },
    { remove: { suit: "s", ranks: "face" } },
    { add: { jokers: 2 } }
  ]);
  assert.equal(cards.length, 52 - 9 - 3 + 2);
  assert.ok(!cards.some((c) => c.suit === "h" && c.rank <= 10));
  assert.ok(!cards.some((c) => c.suit === "s" && c.rank >= 11 && c.rank <= 13));
  assert.ok(cards.some((c) => c.id === "Ah"));
  assert.deepEqual(cards.filter((c) => c.rank === 0).map((c) => c.id), ["X", "X#2"]);
});

test("composition: specific cards, duplicates get unique ids, removals before additions", () => {
  const { cards } = buildDeck([{ add: { cards: ["As", "As"] } }, { remove: { cards: ["As"] } }]);
  assert.equal(cards.length, 53);
  assert.deepEqual(cards.filter((c) => c.rank === 14 && c.suit === "s").map((c) => c.id), ["As", "As#2"]);
});

test("draw takes from the top until empty; reshuffles used cards when dry; burned cards never return", () => {
  let s = createDeckState([{ remove: { suit: "all", ranks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } }], seeded(3));
  assert.equal(s.draw.length, 8); // K and A of each suit
  let r = drawCards(s, 5, seeded(4));
  assert.equal(r.drawn.length, 5);
  assert.equal(r.reshuffled, 0);
  s = discardCards(r.state, r.drawn.slice(0, 3).map((c) => c.id)); // 3 used
  s = burnCards(s, [r.drawn[3].id]); // 1 burned
  r = drawCards(s, 6, seeded(5)); // 3 left in draw, then reshuffle the 3 used
  assert.equal(r.reshuffled, 1);
  assert.equal(r.drawn.length, 6);
  assert.equal(r.short, 0);
  assert.equal(r.state.discard.length, 0);
  assert.equal(r.state.burned.length, 1);
  assert.ok(!r.state.hand.some((c) => c.id === s.burned[0].id));
  r = drawCards(r.state, 1);
  assert.equal(r.short, 1); // nothing left anywhere
  // conservation: every card is in exactly one pile
  const st = r.state;
  assert.equal(st.draw.length + st.hand.length + st.discard.length + st.burned.length, 8);
});

test("hand categories map to the standard integer ranking", () => {
  assert.equal(rank("Ah"), H.highCard);
  assert.equal(rank("Ah", "Kd", "7c", "4s", "2h"), H.highCard);
  assert.equal(rank("9h", "9d"), H.pair);
  assert.equal(rank("9h", "9d", "4c", "4s", "Kh"), H.twoPair);
  assert.equal(rank("9h", "9d", "9c"), H.threeOfAKind);
  assert.equal(rank("5h", "6d", "7c", "8s", "9h"), H.straight);
  assert.equal(rank("Ah", "2d", "3c", "4s", "5h"), H.straight); // ace low
  assert.equal(rank("Th", "Jd", "Qc", "Ks", "Ah"), H.straight); // ace high
  assert.equal(rank("Qh", "Kd", "Ac", "2s", "3h"), H.highCard); // no wraparound
  assert.equal(rank("2h", "7h", "9h", "Jh", "Kh"), H.flush);
  assert.equal(rank("9h", "9d", "9c", "4s", "4h"), H.fullHouse);
  assert.equal(rank("9h", "9d", "9c", "9s"), H.fourOfAKind);
  assert.equal(rank("5h", "6h", "7h", "8h", "9h"), H.straightFlush);
  assert.equal(rank("Ah", "2h", "3h", "4h", "5h"), H.straightFlush);
  assert.equal(rank("Th", "Jh", "Qh", "Kh", "Ah"), H.royalFlush);
});

test("straights and flushes need five cards", () => {
  assert.equal(rank("5h", "6h", "7h", "8h"), H.highCard);
});

test("jokers are wild", () => {
  assert.equal(rank("X"), H.highCard);
  assert.equal(rank("9h", "X"), H.pair);
  assert.equal(rank("9h", "9d", "X"), H.threeOfAKind);
  assert.equal(rank("Th", "Jh", "Qh", "Kh", "X"), H.royalFlush);
  assert.equal(rank("9h", "9d", "9c", "9s", "X"), H.fiveOfAKind);
  assert.equal(rank("9h", "9d", "9c", "X", "X"), H.fiveOfAKind);
  assert.equal(rank("9h", "9d", "4c", "4s", "X"), H.fullHouse);
  assert.deepEqual(evaluateHand(hand("9h", "X")).score, [H.pair, 9]);
});

test("scores break ties within a category", () => {
  const a = evaluateHand(hand("Kh", "Kd")).score;
  const b = evaluateHand(hand("5h", "5d")).score;
  assert.ok(compareScores(a, b) > 0);
  const c = evaluateHand(hand("Ah", "2d", "3c", "4s", "5h")).score; // 5-high straight
  const d = evaluateHand(hand("2h", "3d", "4c", "5s", "6h")).score;
  assert.ok(compareScores(d, c) > 0);
});

test("at most five cards", () => {
  assert.throws(() => evaluateHand(hand("2h", "3h", "4h", "5h", "6h", "7h")));
  assert.equal(evaluateHand([]), null);
});

test("blackjack values", () => {
  assert.equal(blackjackValue(parseCard("7c")), 7);
  assert.equal(blackjackValue(parseCard("Kd")), 10);
  assert.equal(blackjackValue(parseCard("Ah")), 1);
  assert.equal(blackjackValue(parseCard("Ah"), { aceHigh: true }), 11);
  assert.equal(blackjackValue(parseCard("X")), null);
});

test("requirements, scaling and consumption", () => {
  const state = { draw: [], hand: hand("9h", "9d", "4c", "Ks"), discard: [], burned: [], reshuffles: 0 };
  const pair = [state.hand[0].id, state.hand[1].id];
  const scaling = [{ minRank: 1, buff: 1 }, { minRank: 3, buff: 2 }];

  assert.equal(checkHandRequirement(null, {}).ok, false);
  const needTrips = useHand(state, pair, { minRank: H.threeOfAKind });
  assert.equal(needTrips.ok, false);
  assert.equal(needTrips.reason, "tooWeak");
  assert.equal(needTrips.state, state);

  const check = useHand(state, pair, { minRank: H.pair, consume: "none", scaling });
  assert.equal(check.ok, true);
  assert.equal(check.grant.buff, 1);
  assert.equal(check.state.hand.length, 4);

  const spend = useHand(state, pair, { minRank: H.pair, consume: "selected", scaling });
  assert.equal(spend.state.hand.length, 2);
  assert.equal(spend.state.discard.length, 2);

  const cashout = useHand(state, pair, { minRank: H.pair, consume: "hand" });
  assert.equal(cashout.state.hand.length, 0);
  assert.equal(cashout.state.discard.length, 4);
});
