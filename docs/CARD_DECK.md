# Personal card deck: authoring guide

Optional subsystem (§10 of `DESIGN.md`), gated by the world setting **Enable personal card deck** (off by default).

## How it works at the table

1. A character gets a deck only if they own something that interacts with cards: an item with a `deckModify`, `draw` or `pokerHand` effect, or an item tagged `draw` or `cashout`.
2. When the GM starts an encounter (Combat), each such participant gets a **personal deck**: the standard 52 cards, then every `deckModify` effect they own is applied, then it is shuffled once. Participants added after the start get one when they join. The GM can also build one by hand from the sheet's **Cards** tab, with or without an encounter.
3. Cards are drawn from the top. If the draw pile runs dry mid-draw, the **used cards** (spent in hands, or discarded for momentum) are shuffled into a new draw pile and drawing continues. **Burned** cards never come back. If nothing is left anywhere, the draw comes up short and chat says so.
4. On the **Cards** tab the player clicks up to five cards in their hand. The sheet shows the best poker hand they make. Jokers are wild, aces are high or low.
5. Abilities that use a hand are listed below it, lit up when the selected cards qualify. **Use** spends cards as the ability says and posts the result to chat. If the result includes buff or debuff dice, the roll dialog opens pre-filled.
6. **Discard for momentum**: one selected card gives its blackjack value (2–10 face, J/Q/K 10, Ace 1 or 11 by choice) as momentum now, lost again at the start of the next round.
7. Decks belong to the encounter and are removed when the encounter is deleted. A character in two encounters has two decks.

Until the encounter stack (Phase 3) resolves actions automatically, `draw` effects are carried out with the **Draw** button on the Cards tab.

## Hand quality

| Rank | Hand |
|---|---|
| 0 | High card |
| 1 | Pair |
| 2 | Two pair |
| 3 | Three of a kind |
| 4 | Straight |
| 5 | Flush |
| 6 | Full house |
| 7 | Four of a kind |
| 8 | Straight flush |
| 9 | Royal flush |
| 10 | Five of a kind (only with jokers) |

Straights and flushes need five cards. Inside a rank, ties break on the cards (a pair of kings beats a pair of fives); the engine computes this as `score` for future abilities that compare hands.

## Effect formats

Effects go in an item's **Effects** JSON field (the typed editor arrives in Phase 2).

### Changing the deck: `deckModify`

Applied when the deck is built. Removals happen before additions.

```json
{ "op": "deckModify", "args": { "remove": { "suit": "h", "ranks": "number" } } }
{ "op": "deckModify", "args": { "remove": { "suit": "s", "ranks": "face" } } }
{ "op": "deckModify", "args": { "remove": { "suit": "all", "ranks": [2, 3] } } }
{ "op": "deckModify", "args": { "remove": { "cards": ["Ah", "Ks"] } } }
{ "op": "deckModify", "args": { "add": { "jokers": 2 } } }
{ "op": "deckModify", "args": { "add": { "cards": ["As", "As"] } } }
```

Suits: `c` `d` `h` `s` or `"all"`. Ranks: `"number"` (2–10), `"face"` (J, Q, K), `"all"`, or a list of numbers and letters (`2`, `"T"`, `"J"`, `"Q"`, `"K"`, `"A"`). Card codes: rank then suit (`"Th"`, `"10h"`, `"Ac"`), or `"X"` for a joker.

### Drawing: `draw`

```json
{ "trigger": "onResolve", "op": "draw", "args": { "count": 2 } }
```

### Using a hand: `pokerHand`

```json
{
  "op": "pokerHand",
  "args": {
    "label": "Read the table",
    "minRank": 1,
    "consume": "selected",
    "scaling": [
      { "minRank": 1, "buff": 1 },
      { "minRank": 4, "buff": 2 },
      { "minRank": 8, "buff": 3 }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `label` | Name shown on the Cards tab and in chat. Defaults to the item name. |
| `minRank` | Minimum hand rank to use the ability (default 0). |
| `consume` | `selected`: the cards used go to the used pile (default). `hand`: the whole hand does, as §10's cash-in describes. `none`: a requirement only; nothing is spent. |
| `scaling` | Optional. The highest row whose `minRank` the hand meets is granted. |
| `grant` | Optional fixed grant, used alongside or instead of `scaling`. |

Grant keys `buff` and `debuff` open the roll dialog with those dice. Any other keys (`momentum`, `note`, and so on) are shown in chat for the GM to apply. What each hand rank buys is content and still [OPEN] (#26); these are examples only, not canon.

Patterns:

- **Requires a hand**: `"minRank": 3, "consume": "none"`.
- **Consumes a hand of a set quality**: `"minRank": 2, "consume": "selected", "grant": { "buff": 1 }`.
- **Scales with quality**: `scaling` as above.

## Visibility

Deck state is stored on the actor. Foundry sends actor data to every client, so a determined player could read another character's hand through the console. The sheet only shows it to people who can open that sheet.
