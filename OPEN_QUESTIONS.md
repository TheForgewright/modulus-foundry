# Open questions

Seeded from Appendix D of `docs/DESIGN.md`. Each row is undecided by the designers. The code uses the default shown, exposed as a world setting or manual GM control where possible. Do not resolve these in code; ask the designers.

| # | Question | Default used meanwhile | Where in code |
|---|---|---|---|
| 1 | DC preset: 14/11/8 or 13/11/9 | 14/11/8 | settings `dc.*` |
| 2 | DC for unopposed tasks | GM-entered; suggest 11 | setting `defaultTaskDC`, roll dialog |
| 3 | How are talents acquired (XP per talent, tied to skill ranks, free)? How do skills, talents and word packs relate? | Talents carry an optional `xpCost`; eligibility counts talents owned regardless of source |  |
| 4 | Word packs vs skill word lists vs talents granting words | All three can grant words; no automatic pack selection |  |
| 5 | `maxWords` formula and the extra-word penalty | `2 + floor(level/4)`; one debuff die per extra word | setting `maxWordsFormula`, `extraWordPenalty` |
| 6 | Focus bonus magnitude | Off |  |
| 7 | Buff/debuff stacking and caps | Additive, no cap |  |
| 8 | Same-name tag stacking; overlapping stat overrides | Sum; last word wins |  |
| 9 | Momentum floor | None | setting `momentum.floor` |
| 10 | When cost is spent; cancelled entries; cost floor | At resolution; nothing spent if cancelled; floor 0 |  |
| 11 | Which resistance track applies | Domain of target stat |  |
| 12 | Interrupt mechanic and meaning of `interruptible X` | GM-adjudicated button |  |
| 13 | Aid/Hinder specifics | X buff / debuff dice on a lower entry |  |
| 14 | Reaction timing, targeting, no-roll rule | Declared in place of own action |  |
| 15 | `delayed` | Resolves after all non-delayed entries |  |
| 16 | Charge resolution timing | On the Xth consecutive declaration |  |
| 17 | Inevitable specifics (ordering only vs also costs) | Ordering |  |
| 18 | Armor penetrating/ineffective semantics; armor ↔ resistance | Data only |  |
| 19 | Exposed X: flat or dice | Flat |  |
| 20 | Defeat: compounding, effect on defense, break-point effects, recovery | Per track, applies to defense, no break-point penalty, clears when pips return or GM clears | setting `defeatAffectsDefense`; `rules/tier.js` |
| 21 | Damage scaling beyond 1 pip | Manual |  |
| 22 | Pips at level 0; exact break-point structure | Treat level as ≥ 1; segment per level | setting `pips.minLevel`; `rules/tracks.js` `longRest` |
| 23 | Respec and tier-shift rules; floating points | `respecPoints` counter, manual | `respecPoints`, sheet "Re-run allocation" |
| 24 | Scene-track bonus size and the Action/Drama/Intrigue names | 1 buff die; names provisional |  |
| 25 | Room-entry momentum, witness effects, nested-instance linkage | Highest relationship, capped; GM adjusts |  |
| 26 | Deck: draw formula, draw triggers, cash-in menu, blind-mode "double", hand persistence | Deck off by default. Reshuffle-when-dry, per-character decks and composition effects are now decided (`docs/CARD_DECK.md`). Blind mode not built. Hand persists while its encounter exists |  |
| 27 | Opposed/contested rolls | Not built; manual GM roll |  |
| 28 | `draining X` | Not built |  |
| 29 | Cascade depth cap | None, guard 25 |  |
| 30 | Ability builder vs action/word model | Phase 6 only |  |
| 31 | Second example setting (listed as "???" in source) | Out of scope |  |
| 32 | Conditional effects: do shifts above primary give a buff die or clamp | Clamp | setting `condFx.aboveRank`; `rules/tier.js` |
| 33 | Conditional effects: do tier shifts change the owner's defense DC | Yes (`appliesToRolls: all`) |  |
| 34 | Conditional effects: is "nearby" encounter-scoped only, or does distance or range ever matter | Encounter-scoped |  |
| 35 | Teams: is there an ally/enemy distinction for triggers | Not modeled; manual `team` label optional |  |
| 36 | Conditional effects: when a duration-1 effect is gained mid-round, does it apply to remaining resolutions this round or start next round | Applies to the rest of this round |  |
| 37 | Conditional effects: should effects be allowed to grant dice and not only tier shifts at launch | Schema allows it; editor can hide it |  |
| 39 | Extended encounters: what momentum means for investigations and ordeals, and what ends them | Not defined; GM closes manually |  |
| 40 | Extended encounters: does a subject (mystery, wilderness) have HP tracks | Momentum only |  |
| 41 | Extended encounters: do investigations and ordeals use the room-entry and witness rules (§7.11) or only relationships | Relationships only |  |
| 38 | Conditional effects: final trigger list (which of the suggested triggers in §8.1.1 are in v1) | All implemented behind a registry; designers can disable triggers in settings |  |

## Raised during implementation

| # | Question | Default used meanwhile | Where in code |
|---|---|---|---|
| 43 | Long rest: "restores one level's segment". With a partially-lost segment on top of a fully-lost one (e.g. 5 lost at 4 per level), does a long rest restore the partial pips, a full segment's worth, or both? | Restores `perLevel` pips from the most recent loss (5 → 1) | `rules/tracks.js` `longRest` |
| 44 | Pip display order: pips are lost segment by segment and each segment's break point is the last pip lost in it. Is that the intended reading of "the last pip of each segment is a break point"? | Yes; sheet empties pips left to right | `rules/tracks.js`, `templates/actor/main.hbs` |
| 45 | Does a GM "clear defeat" on an empty track persist until the next change to that track? | Yes; any later pip change re-arms it | `documents/actor.js` |
| 47 | Jokers have no blackjack value. Can a joker be discarded for momentum, and for how much? | Not allowed | `rules/deck.js` `blackjackValue` |
| 48 | If a player selects more than five cards, should the engine find the best five, or is five a hard limit on selection? | Hard limit of five | `rules/deck.js`, Cards tab |
| 49 | Should hands be truly hidden from other players (needs GM-held storage), or is sheet-level hiding enough? | Sheet-level only | `docs/CARD_DECK.md` |
| 50 | Marks with requirement-only abilities (`consume: none`): should burn/draw marks fire, and are consumable marks used up? | No and no; `rankUp` still counts | `rules/deck.js` `useHand` |
| 54 | When copies of one mark type have different values (draw 2 on one card, draw 0 on another), whose value applies? | The copy that decides exhaustion: the first-picked permanent copy, else the first-picked consumable copy | `rules/deck.js` `resolveMarks` |
| 52 | A `draw` mark on a dry deck: may the reshuffle include the cards just played? | Yes, unless they were burned | `rules/deck.js` `useHand` |
| 53 | How do marks get onto cards: fixed by content at deck build, chosen by the player during the encounter, or both? | Both (`deckMark`, `cardMark`) | `deck/card-effects.js` |

## Resolved

| # | Question | Decision |
|---|---|---|
| 42 | Tertiary stat with two defeated tracks: 1 or 2 debuff dice? | 2. §3.3 stands (one debuff die per step below tertiary); test 11's wording was wrong. |
| 46 | Do cards discarded for momentum go back into the reshuffle? | Yes, they join the used pile. |
| 51 | Do several marks of the same type in one hand stack? | No. Each mark type applies once per hand. If every copy is consumable, only the first-picked one is exhausted; if any copy is permanent, none is. |
