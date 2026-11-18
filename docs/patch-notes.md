# Modulus for Foundry VTT: patch notes

Newest first. Every build adds a section for its version (`build.sh` checks for it).

## 0.1.1
- **Talents.** A Talents tab on the character sheet shows the talents a character has and every talent they could take, with its XP cost. Locked talents say exactly what they still need. Taking a talent spends its XP; removing one can refund it. The GM can grant a locked talent.
- **Talent editor.** Talent sheets pick their prerequisites from lists of the right tier, flag problems in the prerequisite graph, and show the authoring principles. A Talent graph window (talent sheet or Vocabulary Editor) shows every talent as trees by domain.
- **Conditional effects.** Talents can give tier shifts (or dice) when something happens in an encounter: an action used, being targeted, a hit or miss, a break point, a scene track change, a status, round start, and more. Each effect is built from lists and previewed as a plain sentence. Active effects show in chat, in the Encounter Manager (the GM can remove them) and on the sheet, and every roll card lists the talent effects that changed it.
- **Teams and betrayal.** An optional team label per participant in the Encounter Manager. The same team is an ally; an opposing team is an enemy. Participants with no team are in free for all: stealthed or undeclared characters have no allies or enemies and are nobody's enemy. Changing a team (a reveal, a betrayal, slipping into stealth) is a talent trigger of its own. A new **Change team** effect lets actions, words and statuses do it: set a named team, drop into free for all, recruit the target to your team, or join the target's team.

## 0.1.0
- **First test build.** Character and NPC sheets with the dot allocator, three pip tracks with break points, momentum, and the 3d20 keep-one roll with buff and debuff dice.
- **Vocabulary.** Actions, words, statuses, talents and skills with a typed effects editor and tag chips; the Vocabulary Editor (Items sidebar) with JSON import and export; the Act window to build an action from words and see its cost, dice and chance before rolling.
- **Encounters.** The Encounter Manager (Combat sidebar): participation, declaration in momentum order, the Slow re-confirmation cascade, Fast, Duelist, resolution top to bottom with outcome buttons, Charge, Taxing, Determined, Inevitable, and the surrender check. Players get their prompts as pop-up windows.
- **Optional card deck** (world setting): personal 52-card decks per encounter, poker hands, marked cards.
- **Compendium updates reach your world.** When a new version changes compendium entries, items your world took from those compendiums (in the Items sidebar and on characters) are updated the first time the GM loads the world. Items you edited in the world are left alone and listed for review in Vocabulary Editor → Sync from compendiums. A skill's rank, a status's remaining rounds and worn armor are kept.
- The *Test Fixtures (not canon)* compendium has Strike, Grapple, Recuperate and four words to try it with.
