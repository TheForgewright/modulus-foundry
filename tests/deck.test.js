// Personal card deck (§10).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  standardDeck, buildDeck, createDeckState, drawCards, discardCards, burnCards, parseCard,
  evaluateHand, HAND_RANKS as H, compareScores, blackjackValue, useHand, checkHandRequirement,
  applyDeckMarks, markCards, matchesSelector, normalizeMark
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
  assert.deepEqual(evaluateHand(hand("9h", "X")).score, [H.pair, H.pair, 9]);
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

/* ---------------- Marks ---------------- */

const marked = (code, ...marks) => ({ id: code, ...parseCard(code), marks: marks.map(normalizeMark) });
const stateWith = (handCards, draw = []) => ({ draw, hand: handCards, discard: [], burned: [], reshuffles: 0, markUses: {} });

test("selectors and deck-build marks", () => {
  assert.ok(matchesSelector(parseCard("3h"), { suit: "all", ranks: [2, 3] }));
  assert.ok(!matchesSelector(parseCard("Kh"), { suit: "all", ranks: "number" }));
  assert.ok(!matchesSelector(parseCard("X"), { suit: "all", ranks: "all" }));
  assert.ok(matchesSelector(parseCard("X"), { cards: ["X"] }));
  const s = createDeckState([], seeded(2), [{ target: { suit: "all", ranks: [2] }, mark: { type: "burn" } }]);
  const markedCards = s.draw.filter((c) => c.marks.length);
  assert.deepEqual(markedCards.map((c) => c.rank), [2, 2, 2, 2]);
  assert.deepEqual(markedCards[0].marks, [{ type: "burn", value: 0, consumable: false }]);
  assert.throws(() => normalizeMark({ type: "explode" }));
});

test("burn mark: every card in the played hand is burned, others in hand stay", () => {
  const st = stateWith([marked("2h", { type: "burn" }), marked("2d"), marked("Ks")]);
  const r = useHand(st, ["2h", "2d"], { minRank: H.pair });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.burned.map((c) => c.id), ["2h", "2d"]);
  assert.equal(r.state.discard.length, 0);
  assert.deepEqual(r.state.hand.map((c) => c.id), ["Ks"]);
  assert.equal(r.burned.length, 2);
});

test("burned cards are not reshuffled; unburned used cards are", () => {
  let st = stateWith([marked("2h", { type: "burn" }), marked("2d"), marked("5c"), marked("5s")]);
  st = useHand(st, ["2h", "2d"], { minRank: H.pair }).state;
  st = useHand(st, ["5c", "5s"], { minRank: H.pair }).state;
  const r = drawCards(st, 4);
  assert.deepEqual(r.drawn.map((c) => c.id).sort(), ["5c", "5s"]);
  assert.equal(r.short, 2);
});

test("burn with consume 'hand': played cards burn, the rest of the hand goes to the used pile", () => {
  const st = stateWith([marked("2h", { type: "burn" }), marked("2d"), marked("Ks")]);
  const r = useHand(st, ["2h", "2d"], { consume: "hand" });
  assert.deepEqual(r.state.burned.map((c) => c.id), ["2h", "2d"]);
  assert.deepEqual(r.state.discard.map((c) => c.id), ["Ks"]);
});

test("draw mark: fixed value, and 0 = as many cards as were played", () => {
  const draw = [marked("Ac"), marked("Ad"), marked("Ah"), marked("As")];
  let r = useHand(stateWith([marked("9h", { type: "draw", value: 1 }), marked("9d")], draw), ["9h", "9d"]);
  assert.equal(r.drawn.length, 1);
  assert.equal(r.state.hand.length, 1);
  r = useHand(stateWith([marked("9h", { type: "draw", value: 0 }), marked("9d"), marked("9c")], draw), ["9h", "9d", "9c"]);
  assert.equal(r.drawn.length, 3);
});

test("draw mark can reshuffle the cards just used when the deck is empty", () => {
  const r = useHand(stateWith([marked("9h", { type: "draw" }), marked("9d")]), ["9h", "9d"]);
  assert.equal(r.reshuffled, 1);
  assert.equal(r.drawn.length, 2);
  assert.equal(r.state.discard.length, 0);
});

test("rankUp mark: the hand counts one rank higher, capped at five of a kind", () => {
  const pair = evaluateHand([marked("9h", { type: "rankUp" }), marked("9d")]);
  assert.equal(pair.baseRank, H.pair);
  assert.equal(pair.rank, H.twoPair);
  assert.equal(pair.name, "twoPair");
  const two = evaluateHand([marked("9h", { type: "rankUp" }), marked("9d", { type: "rankUp" })]);
  assert.equal(two.rank, H.twoPair); // once per hand: two rankUp marks still count +1
  const cap = evaluateHand([marked("9h", { type: "rankUp", value: 5 }), marked("9d"), marked("9c"), marked("9s"), marked("X")]);
  assert.equal(cap.rank, H.fiveOfAKind);
  // and it unlocks abilities the cards alone could not
  const r = useHand(stateWith([marked("9h", { type: "rankUp" }), marked("9d")]), ["9h", "9d"], { minRank: H.twoPair });
  assert.equal(r.ok, true);
});

test("consumable marks are stripped after firing; permanent ones stay", () => {
  const st = stateWith([marked("9h", { type: "draw", value: 1, consumable: true }, { type: "rankUp" }), marked("9d")], [marked("2c")]);
  const r = useHand(st, ["9h", "9d"]);
  assert.equal(r.drawn.length, 1);
  const used = r.state.discard.find((c) => c.id === "9h");
  assert.deepEqual(used.marks, [{ type: "rankUp", value: 1, consumable: false }]);
  assert.equal(r.marksFired.length, 2);
});

test("each mark type applies once per hand", () => {
  const draw = [marked("2c"), marked("3c"), marked("4c"), marked("5c")];
  const st = stateWith([marked("9h", { type: "draw", value: 1 }), marked("9d", { type: "draw", value: 1 })], draw);
  const r = useHand(st, ["9h", "9d"]);
  assert.equal(r.drawn.length, 1);
  assert.equal(r.marksFired.length, 1);
});

test("the first-picked copy is used: its value applies and only it is exhausted", () => {
  const st = stateWith([
    marked("9h", { type: "draw", value: 1, consumable: true }),
    marked("9d", { type: "draw", value: 1, consumable: true })
  ], [marked("2c"), marked("3c")]);
  // the player picked 9d first
  const r = useHand(st, ["9d", "9h"]);
  assert.equal(r.drawn.length, 1);
  const pile = Object.fromEntries(r.state.discard.map((c) => [c.id, c.marks.length]));
  assert.deepEqual(pile, { "9d": 0, "9h": 1 });
});

test("permanence is not considered: the first-picked copy wins either way", () => {
  const draw = () => [marked("2c"), marked("3c"), marked("4c")];
  const cards = () => [marked("9h", { type: "draw", value: 1, consumable: true }), marked("9d", { type: "draw", value: 2 })];
  // consumable picked first: value 1, and it is exhausted
  let r = useHand(stateWith(cards(), draw()), ["9h", "9d"]);
  assert.equal(r.drawn.length, 1);
  assert.equal(r.state.discard.find((c) => c.id === "9h").marks.length, 0);
  assert.equal(r.state.discard.find((c) => c.id === "9d").marks.length, 1);
  // permanent picked first: value 2, nothing exhausted
  r = useHand(stateWith(cards(), draw()), ["9d", "9h"]);
  assert.equal(r.drawn.length, 2);
  assert.ok(r.state.discard.every((c) => c.marks.length === 1));
});

test("rankUp follows the same rule", () => {
  const st = stateWith([
    marked("9h", { type: "rankUp", consumable: true }),
    marked("9d", { type: "rankUp", consumable: true })
  ]);
  const r = useHand(st, ["9h", "9d"], { minRank: H.twoPair });
  assert.equal(r.ok, true);
  assert.equal(r.hand.rank, H.twoPair);
  assert.deepEqual(r.state.discard.map((c) => c.marks.length), [0, 1]);
});

test("consume 'none' fires no burn/draw marks and strips nothing", () => {
  const st = stateWith([marked("9h", { type: "burn", consumable: true }), marked("9d")], [marked("2c")]);
  const r = useHand(st, ["9h", "9d"], { consume: "none" });
  assert.equal(r.state, st);
  assert.equal(r.marksFired.length, 0);
});

test("markCards puts a mark on cards in any pile", () => {
  const st = stateWith([marked("9h")], [marked("2c")]);
  const s2 = markCards(st, ["9h", "2c"], { type: "draw", value: 2, consumable: true });
  assert.equal(s2.hand[0].marks[0].type, "draw");
  assert.equal(s2.draw[0].marks[0].value, 2);
  assert.equal(st.hand[0].marks.length, 0); // immutable
});
