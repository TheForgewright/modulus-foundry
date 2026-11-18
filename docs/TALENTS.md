# Talents: authoring and play

Talents (§8 of `DESIGN.md`) are bought with XP and unlock in tiers. Their conditional effects (§8.1) give tier shifts for a few rounds when something happens in an encounter.

## Authoring a talent

Create talents in the Vocabulary Editor (type *Talent*) or in a compendium. On the talent sheet:

- **Domain, tier, XP cost.** Each talent has its own XP cost.
- **Talent id.** Filled in from the name when the talent is created; other talents point at it as their prerequisite, so it survives renames and copies. Change it only before anything depends on it.
- **Prerequisites.** Tier 2 picks one tier-1 talent (any domain). Tier 3 picks its tier-2 parent and, optionally, a second tier-1 talent from another tree (not the parent's own tier-1). The lists only offer talents of the right tier. Problems with this talent's place in the graph show in red under the pickers.
- **Talent graph** (button on the sheet, or in the Vocabulary Editor) shows every talent by domain as trees, with every graph problem listed.
- **Authoring principles** are under the sheet's *Authoring principles* heading.

## Conditional effects

Each effect reads as a sentence, previewed under it, for example:

> When another character resolves a hit with strike + offensive, you gain +1 tier in Physical Finesse until the end of the round.

| Part | What it sets |
|---|---|
| **When** | The event (action used, targeted by an action, hit, miss, word used, break point, scene track change, status applied or removed, defeated or recovered, pips lost, momentum crossing a value, stack position, re-confirmed, interrupted, round start or end, encounter start, participant joined or left, surrendered, tier changed, extended encounter momentum, card event, rest, or a manual button), **who** does it (this character, another participant, anyone, someone targeting this character, someone this character targets, an ally, an enemy), and for actions the tags it must carry (all of them; extra tags are fine), declare or resolve, and hit or miss. |
| **Only if** | Extra conditions, all of which must hold: momentum above or below a value, has or lacks a status, pips at or below a value, round number, the action's stat or domain, where the other character sits in the stack, or the first use of a tag set this round. |
| **Gives** | Tier shifts (a stat, a domain or expression with `*`, every stat, or whatever the action rolls or targets; + raises, − lowers) and optionally buff or debuff dice. *Lands on* picks who gets them: this character, whoever triggered it, the action's target, or everyone. *Applies to* limits them to own rolls or to defense. |
| **For** | Rounds (1 = the rest of this round; 0 = only the next roll), or until the end of the round, the start of their next turn, or the end of the encounter. What happens when it triggers again (refresh, stack up to a maximum, ignore) and how many times it may fire per round. |

Red text lists what is missing. A warning appears when an effect would fire every round with no conditions: that is a passive bonus, which §2.5 forbids.

Effects never set each other off, except effects whose event is *Tier changed*, and those stop three steps deep (setting *condFx.chainDepth*). Triggers can be switched off world-wide in the settings.

## In play

- **Talents tab** on the character sheet: XP available, how many talents the character has per domain and tier, their talents (with buttons for manual effects), every talent they could take with its cost, and for locked ones exactly why ("Needs 2 more physical tier-1 talents", "Needs Reads the Opening"). **Take** spends the XP. A GM can **Grant** a locked talent. Removing a talent offers to refund its XP.
- **In an encounter**, talent effects trigger from what happens in that encounter only. When one applies, chat says what and for how long; the Encounter Manager shows it on the participant (the GM can remove it), and the character's Talents tab lists it.
- **Rolls** use every active shift: the roller's own, and the defender's when the DC is looked up. The roll card lists each talent effect that changed the roll. The Declare window previews them.
- **Teams.** Each participant in the Encounter Manager has an optional team label. The same label is an **ally**; a different label is an **enemy**. A participant with no label is in **free for all**: they have no allies or enemies and are nobody's enemy, so a stealthed character's target is a victim, not an opponent. Leave stealthed or undeclared characters blank and give them a team when they reveal themselves.
- **Double-crosses and reveals.** Labels are each participant's apparent team, visible to everyone; there are no hidden teams. Mechanics change the apparent team, through the *Change team* effect on an action, word or status (set a team, drop into free for all, join the actor's or the target's team), or by the GM in the Encounter Manager. Changing a participant's team is the *Team changed* trigger: they reveal a side, drop into free for all, or switch sides, and the effect can require that they are now (or were) an ally or enemy of the talent's owner. A betrayal talent reads "When another character switches sides (they were your ally)…".
