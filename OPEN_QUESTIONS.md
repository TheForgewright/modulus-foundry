# Open questions

Seeded from Appendix D of `docs/DESIGN.md`. Each row is undecided by the designers. The code uses the default shown, exposed as a world setting or manual GM control where possible. Do not resolve these in code; ask the designers.

| # | Question | Default used meanwhile | Where in code |
|---|---|---|---|
| 1 | DC preset: 14/11/8 or 13/11/9 | 14/11/8 | settings `dc.*` |
| 2 | DC for unopposed tasks | GM-entered; suggest 11 | setting `defaultTaskDC`, roll dialog |
| 3 | How do skills, talents and word packs relate? (Acquisition is decided: see Resolved.) | Eligibility counts talents owned regardless of source |  |
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
| 52 | A `draw` mark on a dry deck: may the reshuffle include the cards just played? | Yes, unless they were burned | `rules/deck.js` `useHand` |
| 53 | How do marks get onto cards: fixed by content at deck build, chosen by the player during the encounter, or both? | Both (`deckMark`, `cardMark`) | `deck/card-effects.js` |
| 55 | `resistanceTrack` alternative "the action's own domain tag": actions have no domain field. | The alternative uses the domain of the rolling stat | `rules/assembly.js` `resistanceDomain` |
| 56 | Focus bonus magnitude when the hook is turned on. | 1 buff die if fewer words than the maximum are used | `rules/assembly.js`, setting `focusBonus` |
| 57 | Who can use which actions and words: §6.1 says trained actions need granting, §6.2 says base words are known by all. Are untrained actions and non-base untrained words available to everyone? | Untrained world actions: everyone. Words: base words for everyone, others only when on the character | `apps/action-builder.js` `availableVocabulary` |
| 58 | §11 says the packs ship "empty plus fixtures", §17.3 says fixtures are "not canon; do not ship as content". | Content packs ship empty; fixtures ship in a separate pack labelled "Test Fixtures (not canon)", hidden from players | `system.json`, `packs/_source/test-fixtures` |
| 59 | Should the declaration-time "When declared" effects of the target's statuses (e.g. defensive stances) affect the attacker's assembly? | No; only the actor's own statuses' "while" effects, plus Exposed on the target | `rules/assembly.js` |
| 60 | Resolution ties between entries whose participants never rolled off (e.g. a Slow entry landing on someone else's momentum): how are they broken? | Each tied participant rolls a d20 at that moment, re-rolling equal results; higher resolves first | `rules/encounter.js` `settleTies` |
| 61 | Inevitable: does the streak end when the actor takes a different action, or only on success? | Also ends when they take a different action | `rules/encounter.js` `resolveEntry` |
| 62 | Charge: is the cost paid once on resolution, or each round declared? | Once, on resolution; charging rounds spend nothing | `rules/encounter.js` |
| 63 | Aid / Hinder: when the aiding entry rolls and misses, does the aid still apply? | No; it applies on a hit or when the aiding action does not roll | `rules/encounter.js` `resolveEntry` |
| 64 | Statuses tick per encounter round. A character in two running encounters ticks in both. Should durations follow one "master" clock? | Tick in every encounter they are in | `encounter/controller.js` `tickStatuses` |
| 65 | Can momentum be edited mid-round? It is read at the start of declaration for ordering. | Yes; edits after declaration starts affect costs and later rounds, not this round's order | `rules/encounter.js` `beginDeclaration` |
| 66 | On-hit effects with ops the engine cannot apply directly (dice, tier shifts imposed on a target) | Offered as GM notes until conditional effects (Phase 4) exist | `encounter/outcomes.js` |
| 67 | When a compendium entry changes and a world copy of it was also edited in the world, which wins? | The world edit, until the GM chooses to replace it (Sync from compendiums) | `rules/compendium-sync.js` |
| 68 | Which actions does a skill modify (listed actions, actions with a tag, actions using a stat?), and do two skills on one roll stack? **Deferred:** skills may be removed entirely; the designers are deciding whether to focus on talents instead. | Not built; no further skill work until decided | `data/item.js` SkillData |
| 69 | Can players take a talent they cannot afford or that is locked? | No; a GM can grant one anyway (the XP is still spent) | `talents/talents.js` `takeTalent` |
| 70 | Removing a talent: refund its XP? | The GM or player chooses when removing; refund is the default | `talents/talents.js` `removeTalent` |
| 71 | "Until the start of the owner's next turn": the stack has no turns. | The start of the next round | `rules/condfx.js` `expireEffects` |
| 72 | Do talent effects apply outside an encounter (the Act window)? | No: "nearby" is the encounter instance (§8.1.2), so effects exist only inside one | `encounter/condfx-bridge.js` |
| 73 | Delayed effects: do they fire at the start or the end of the due round, and outside an encounter? | Start of the due round (delay 1 = start of next round); outside an encounter they apply immediately; pending ones end with their encounter | `rules/delayed.js`, `encounter/outcomes.js` |

## Resolved

| # | Question | Decision |
|---|---|---|
| 42 | Tertiary stat with two defeated tracks: 1 or 2 debuff dice? | 2. §3.3 stands (one debuff die per step below tertiary); test 11's wording was wrong. |
| 46 | Do cards discarded for momentum go back into the reshuffle? | Yes, they join the used pile. |
| 51 | Do several marks of the same type in one hand stack? | No. Each mark type applies once per hand. |
| 54 | Which copy of a mark type is used, and whose value applies? | The copy on the card the player picked first, regardless of permanence. Its value applies; it is exhausted only if consumable. |
| 3a | How are talents acquired? | For now, each talent has its own XP cost, set on the talent (`xpCost`). Phase 4 spends it from the character's XP when a talent is taken. |
| 3b | How do skills affect actions? | A skill adds its rank as a flat bonus to rolls of the actions it modifies; one of the few flat bonus sources. Which actions: #68. |
| 35 | Teams: is there an ally/enemy distinction? | Team labels per participant. Ally = same team; enemy = only someone on an opposing team. No label = free for all: no allies, no enemies, nobody's enemy (a stealthed character's target is a victim, not an opponent). Changing a label (reveal, betrayal, slipping into stealth) is the `teamChanged` trigger. |
| 35a | Can a participant have a hidden team only the GM sees? | No. Labels are the apparent team, visible to all; mechanics (reveals, betrayals) change the apparent team. |
