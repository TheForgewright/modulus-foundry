# Modulus for Foundry VTT

A Foundry VTT **game system** (id `modulus`) for Modulus, a tabletop RPG in which physical, mental and social conflict run on one engine.

- Design and rules: [`docs/DESIGN.md`](docs/DESIGN.md) (the handoff document; it wins over older material).
- Undecided rules and the defaults in use: [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
- Target: Foundry **v14** (verified against 14.370 type definitions).

## Status

Phase 1 (Foundation) from §18 of the design:

| Area | State |
|---|---|
| Pure rules engine (`module/rules/`): dice, allocation, tracks, effective tier, momentum, formula settings | Done, unit-tested |
| Tests 1–3 (§17.2): dice distributions vs Appendix B, allocation, pips | Passing |
| System manifest, actor and item data models | Done |
| Character / NPC sheet: dot allocator, tier badges, pip tracks with break points, momentum, items, hand tools | Done |
| World settings for every OPEN / DRAFT rule (§16) | Registered |
| Roll engine through Foundry `Roll`, roll dialog, chat card with kept / dropped dice and Hit / Miss | Done |
| Compendium packs with test fixtures (§17.3) | Phase 2 |
| Optional personal card deck (§10): composition effects, draw with reshuffle, poker hand picker, hand-quality abilities, marked cards, discard for momentum, burn | Done early; see [`docs/CARD_DECK.md`](docs/CARD_DECK.md) |

Phases 2–6 (vocabulary editor, encounter stack, talents, persistent encounters, optional subsystems) are not started.

## Layout

```
system.json
module/
  modulus.js       entry point (init hook)
  config.js        constants and label keys
  settings.js      world settings (§16)
  rules/           PURE JS. No Foundry imports. Unit-tested.
  data/            TypeDataModel classes for actors and items
  documents/       ModulusActor, ModulusItem, ModulusRoll
  apps/            sheets and the roll dialog
templates/  styles/  lang/en.json
tests/             node:test suites for module/rules
docs/DESIGN.md
```

`module/rules/` must never import Foundry; `tests/purity.test.js` enforces that.

## Development

Requires Node 20+. No dependencies.

```bash
npm test
```

To try it in Foundry, symlink or copy this folder into your Foundry data directory as `Data/systems/modulus`, then create a world using the Modulus system.

## Macro API

`game.modulus` exposes `rules` (the pure engine), `openRollDialog(actor, defaults)`, `buildRollPlan`, `rollFromPlan` and `ModulusRoll`.

```js
game.modulus.openRollDialog(actor, { statKey: "physical.power", buff: 1 });
game.modulus.rules.hitChance({ tier: "secondary", buff: 1, dc: 11 }); // 0.6875
```
