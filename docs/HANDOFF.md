# Handoff notes (from the cloud session, 2026-11-20)

Read `CLAUDE.md` first; it has the working rules. These notes add the history and state that aren't written down anywhere else.

## Where things stand

- **Branch:** all work is on `claude/brave-rubin-om0s98`. It has never been merged to `main`. Ask the owner before merging or opening a pull request.
- **Deployed:** 0.1.1 is installed on Bellows. It was deployed from the owner's PC with `./build.sh 0.1.1`; the server-side compendium check passed.
- **Not tested in real Foundry:** every feature since Phase 1. All checks so far ran in Node: 140 unit tests, the load, actions and render checks, and an end-to-end round against mocked documents. Expect the first real play session to turn up bugs in clicks, form saves, player prompts (user queries), dice and CSS. Fix those first.
- **Next version:** 0.1.2. Add a `## 0.1.2` section at the top of `docs/patch-notes.md` before building.

## Built so far

- **Phases 1–3 complete:** sheets, the 3d20 roll engine, vocabulary with typed effects, the Vocabulary Editor, the Act window, the encounter stack (Slow cascade, Fast, Duelist, Charge, Taxing, Determined, Inevitable, aid and hinder, interrupts, surrender check) and the Encounter Manager with player prompts.
- **Phase 4, talents part:**
  - eligibility, with reasons shown when a talent is locked;
  - XP spending;
  - *Also requires* chains, which are how talent levels work;
  - the talent editor and the talent graph;
  - conditional effects with 31 triggers.
- **Additions requested by the owner along the way:**
  - optional card deck: per-character, composition effects, marks, reshuffle when the deck runs dry;
  - delayed effects;
  - the *Change team* effect;
  - free-for-all teams and the team-change trigger;
  - unknown-word penalty and tier downgrade;
  - XP thresholds;
  - compendium content read directly (no importing);
  - compendium copy sync;
  - build and deploy with compendium verification.

## Owner decisions that reshaped the design (all recorded in DESIGN.md / OPEN_QUESTIONS.md)

- **Progression:** no skills and no levels. XP is an expendable resource spent on talents, and a talent's levels are separate talents chained by *Also requires*.
- **XP thresholds:** ten world settings measured against **earned** XP (spent or banked) stand in for level: pips and break points, momentum ceiling, word slots. The owner may remove this later; it exists for testing.
- **Words:** any character may use any word. If they don't know it, the word's *roll penalty* and/or *tier downgrade* applies. Both fields are kept while the designers playtest (#78). A character knows base words, words on their sheet, and words their talents grant.
- **Teams:** labels show the *apparent* team and there are no hidden teams. The same label means allies and an opposing label means enemies. No label means free for all: no allies or enemies, and nobody's enemy. Reveals and betrayals are mechanics, using the *Change team* effect and the *Team changed* trigger.
- **Card deck:**
  - when the deck runs dry, used cards are reshuffled in, and that includes cards discarded for momentum;
  - each mark type applies once per hand, and the copy on the card the player picked first is used, regardless of permanence;
  - compendium content is read directly (`vocab/catalog.js`), and world copies override the entry they came from.

## Mistakes made here, so they aren't repeated

- **Commit only when the build's own exit status is 0.** A command that chained `build | grep ... && git commit` committed a failing build once, because grep succeeded. Use `./build.sh X > log 2>&1; status=$?`, then commit only if `$status` is 0.
- **Don't assign ApplicationV2's own properties:** `state`, `rendered`, `element`, `form` and `window`. The Action Builder once assigned `this.state`, a read-only getter, which would have broken the window. The actions check now catches this.
- **Opening a LevelDB pack rewrites its files.** The compendium check reads copies for that reason. Don't open packs under `packs/` in place.
- **Inspect the render check's output, not just pass or fail.** A blank field from missing data passes the check. Reading the output found one real bug: chosen words dropped out of the Act window.

## Owner's environment

- **Shells on the PC:** Windows PowerShell 5 doesn't support `&&`; `build.sh` needs Git Bash. The Claude CLI is at `C:\Users\TheFo\.local\bin\claude.exe`, and that folder may not be on PATH yet.
- **Deploy config:** `deploy.local.conf` (untracked) points at Bellows, copied from the Tri-Stat workshop with `DEPLOY_BACKUPS` set to a Modulus folder.
- **Related repo:** the owner also builds Tri-Stat (`TristatClaudeBase`, private). Modulus copied its build and deploy setup. Don't touch that repo from here.

## Likely next work (ask the owner which)

1. **Fix whatever the first real play session turns up** on the 0.1.1 test world: character sheet, Act window, an encounter round, and a player connected.
2. **Rest of Phase 4:** a character creation flow (dot allocation, ancestry, society, backgrounds) and a respec that spends respec points.
3. **Phase 5, persistent encounters:**
   - momentum resets when a non-persistent encounter ends;
   - relationships, investigations and ordeals keep their momentum;
   - room-entry momentum;
   - subjects (a GM-controlled participant, such as the mystery or the wilderness);
   - the scene-track choice with its bonus die;
   - a prompt to change scene track at a break point.
4. **Phase 6:** armor feeding momentum resistance, card-deck blind mode, and the ability builder. The builder needs a designer decision first.

The open questions most likely to come up in play:
- #57: who can use which actions;
- #60–66: encounter edge cases;
- #69–73: talents and delayed effects;
- #76–78: unknown words.
