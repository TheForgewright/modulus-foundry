# Modulus for Foundry VTT

A Foundry VTT **v14** game system (`modulus`). The rules and the implementation plan are in `docs/DESIGN.md`; it wins over older material. Undecided rules and the defaults in use are in `OPEN_QUESTIONS.md`.

## How the owner works with you

- **Preferences (verbatim):** "Use direct speech. Avoid pointless compliments. When gathering information only ask a single question, not a list."
- **Question only means answer only.** When the owner asks a question, answer it; don't build.
- **Don't invent rules.** Items marked [OPEN] get a setting or a manual GM control with the documented default, and a row in `OPEN_QUESTIONS.md`. When the owner decides one, move it to the Resolved table and record the decision in `docs/DESIGN.md` where it applies.
- **Content is human-authored.** Don't write talents, trees, words or actions beyond the §17.3 test fixtures.
- **Trace before saying something is built:** template element → registered action → function → fields read and written → what's displayed.

## Build and deploy

- **Only release through `./build.sh <version>`.** It checks `docs/patch-notes.md` has a `## <version>` section, sets the version in `system.json`, builds the compendium packs, runs the load check, the actions check and the unit tests, zips the system as `dist/modulus-v<version>.zip`, and records the pass in `dist/build-<version>.json`. Any failure stops it.
- **Every passing build deploys to the owner's Foundry server** (`deploy.sh`, run by `build.sh`; it restarts Foundry, players being disconnected is fine). `./deploy.sh --rollback` restores the previous version. Server details live in the untracked `deploy.local.conf` (see `deploy.local.conf.example`). `--no-deploy` builds without deploying.
- **Compendiums ship on every deploy.** `build.sh` recompiles every pack from `packs/_source/` (never trusts the committed binaries), checks each compiled pack holds exactly its sources, then checks the packs read back out of the zip match too; `deploy.sh` refuses to install a zip whose compendiums are incomplete. Edit compendium content in `packs/_source/` (or author in the world and export with the Vocabulary Editor): changes made inside Foundry to the system's own compendiums are replaced by the next deploy.
- **World copies follow the compendium.** Items pulled into a world from a system compendium are independent copies; `module/compendium/sync.js` updates them when the GM first loads the world on a new system version (setting *Update compendium copies on system updates*, on by default). Unedited copies update automatically; copies edited in the world are listed for the GM (Vocabulary Editor → Sync from compendiums); a skill's rank, a status's value and remaining rounds, and worn armor are never overwritten (`rules/compendium-sync.js` `KEEP_FIELDS`, extend it when a new item field belongs to the copy). Keep compendium entry ids stable: the link is the entry's uuid.
- Bump the patch version for each delivered change (0.1.1, 0.1.2…). Before building, add the version's section at the top of `docs/patch-notes.md`: plain English, what changed for players and GMs.
- After each feature: commit, push to `origin`, and tell the owner what changed in a few plain sentences.

## Checks

- `npm test`: unit tests for everything under `module/rules/` (pure JS, no Foundry imports; `tests/purity.test.js` enforces it), plus the language-key test and the end-to-end encounter round against mocked documents.
- `harness/load-check.mjs`: imports every module with stand-in Foundry globals, runs the init hook, and checks every template, manifest path and document type it registers exists.
- `harness/compendium-check.mjs [zip]`: every pack in `system.json` matches its sources, in `packs/` and, given a zip, in the zip.
- `harness/actions-check.mjs`: every `data-action` in a template is registered on the window that renders it; no class assigns ApplicationV2's own `state`, `rendered`, `element`, `form` or `window`.

## Layout

```
system.json  module/  templates/  styles/  lang/  packs/     what ships (see scripts/make-zip.mjs)
module/rules/        pure rules engine, unit-tested
module/data/         TypeDataModels
module/documents/    Actor, Item, Roll, Combat, Combatant classes
module/apps/         sheets and windows (ApplicationV2)
module/encounter/    GM controller, player queries, outcome application
module/deck/         card-deck effects and lifecycle
module/talents/      talents on characters, the conditional-effects editor model
packs/_source/       compendium sources as JSON (npm run build:packs)
harness/  tests/     checks, not shipped
docs/                DESIGN.md, VOCABULARY.md, ENCOUNTERS.md, TALENTS.md, CARD_DECK.md, patch-notes.md
```

## Architecture

- **Pure first.** Rules logic goes in `module/rules/` as pure functions with tests; Foundry code stays thin.
- **Encounters** are Combats; the engine state is JSON text in `flags.modulus.state` (saved wholesale, never merged). Momentum, participation and scene track are combatant flags. The GM client runs `encounter/controller.js`; players only answer user queries (`encounter/queries.js`). Never rely on `game.combat`.
- **Compendium copies** carry `flags.modulus.compendiumSource` and a `syncHash` fingerprint set on creation (`preCreateItem`) and on every sync; the character sheet's item drop records the source too.
- **Talents** (`rules/talents.js`, `talents/talents.js`) are linked by `system.talentId`, never by name or document id. **Conditional effects** (`rules/condfx.js`) live in the encounter state as `condfx`; the controller emits events at each step of the round, `encounter/events.js` emits the rest (track, momentum, pips, statuses, cards, rests, manual), and `encounter/condfx-bridge.js` turns combat facts into matcher context and supplies roll-time shifts. New triggers: add a `TRIGGERS` row, an emitter, and its labels.
- **Effects** are `{trigger, op, args, to}` rows described by `rules/effects.js`; outcomes are offered to the GM as chat buttons (`encounter/outcomes.js`).
- **Verify Foundry APIs** against the v14 type definitions (`@league-of-foundry-developers/foundry-vtt-types`) before using them.
