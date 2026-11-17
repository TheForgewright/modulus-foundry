# Running encounters

How the encounter stack (§7 of `DESIGN.md`) works at the table.

## Opening the Encounter Manager

- **Encounter Manager** button at the top of the Combat sidebar, or the encounter name in a character sheet's Momentum block, or the macro `game.modulus.openEncounterManager()`.
- The GM sees every encounter and drives them. Players see the encounters their characters are in, read-only, with their own momentum editable.
- Several encounters can run at once (a brawl inside a trial, a relationship running alongside). Each has its own momentum per participant. Statuses live on the character, so they carry across.

## Setting up

1. **New encounter**: name, kind (standard, relationship, investigation, ordeal), persistent, nested inside another, scale. Ticking *Add selected tokens* adds the tokens you have selected.
2. Add more with **Add selected tokens**, or drag actors from the sidebar onto the participant table (no token needed, useful for relationships).
3. Each participant starts at their sheet's *starting* momentum. Momentum is per encounter from then on: the GM and the owning player can edit it in the manager or on the sheet.

## A round

| Phase | What happens | GM controls |
|---|---|---|
| **Between rounds** | | **Start round**: from round 2, everyone gains *gain per round* up to their ceiling. |
| **Participation** | Each player gets a dialog: which of their characters take part, their momentum, and their scene track. NPCs are set by the GM in the table. | **Re-send**, then **Close participation and declare**. |
| **Declaring** | Order is fixed by momentum, lowest first. Ties roll a d20 (re-rolling equal results); the rolloff is posted to chat. The lower roll declares earlier, the higher declares later and resolves earlier. Each participant in turn gets the **Declare** window (the Act window in declare mode): pick an action, words and a target (another participant, or an entry already on the stack for reactions, aid and hinder), see cost, dice and chance, and **Declare** or **Pass**. | **Act for them**, **Pass**, **Re-send**. |
| ↳ Slow cascade | A Slow declaration Locks its entry and drops it below others. Everyone who already submitted, is not Locked, and now sits above it is asked to **re-confirm**: their window opens pre-filled with a note saying who caused it. Keep, or change; changing to another Slow action starts a new cascade. Locked entries are never asked. A guard stops runaway cascades after 25 prompts. | **Force confirm**, **Act for them**. |
| **Finalization** | Each Duelist X entry, from the top down, may lower its effective momentum by 0 to X; the amount becomes a flat bonus on its roll. | **No drop**, **Act for them**. |
| **Execution** | Entries resolve top to bottom. **Resolve** looks up the DC now (the target may have changed), rolls, posts the card, and spends the cost from encounter momentum (Determined refunds on a miss). The card lists the hit, miss or always effects with **Apply** buttons; *Auto-apply outcomes* in settings applies them immediately. | **Resolve**, **Interrupt** (cancels an entry; it spends nothing). |
| **Surrender check** | Participants defeated on a track, below zero momentum, or with every track empty are flagged. Nobody is removed automatically. | Mark someone **out**, or bring them back, then **End round**. |

At the end of a round the stack clears, Taxing cooldowns tick, statuses with a duration in rounds count down, and *until next turn* statuses clear when the next round starts.

## Stack entry badges

| Badge | Meaning |
|---|---|
| Submitted | Declared; may be asked to re-confirm. |
| Locked | Declared a Slow action; auto-confirms when a cascade passes. |
| Charging n/X | A Charge X action declared n rounds in a row. It resolves on the Xth (setting) and spends nothing until then. Next round the declare window offers to keep charging; anything else resets the count. |
| Dashed outline | Waiting to re-confirm. |
| Solid outline | Resolves next. |

The big number is the effective momentum: start momentum − Slow + Fast − Duelist drop. Hover it for the breakdown.

## Other tags

- **Aid X / Hinder X** on an entry that targets a lower stack entry: when it resolves (and hits, if it rolls), the target entry gets X buff or debuff dice.
- **Taxing X**: after resolving, X full rounds must pass before another Taxing action.
- **Inevitable**: each failed attempt makes every other participant count as 1 momentum lower for ordering, cumulatively; success resets it.
- **Delayed**: resolves after every non-delayed entry.
- **Recovery**: the only actions declarable at 0 or less momentum.

## Players

Players answer through dialogs that pop up on their screen. If a player closes one without answering, or is offline, the manager shows who it is waiting on, and the GM can re-send or act for them. NPC turns always wait for the GM.

## The sidebar tracker

The core Combat tracker still works but is secondary: its round button runs the same Modulus round start, and the initiative column mirrors encounter momentum.
