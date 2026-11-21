# Modulus for Foundry VTT: patch notes

Newest first. Every build adds a section for its version (`build.sh` checks for it).

## 0.1.3
- **Character creation.** New characters get a *Create character* button on their sheet. It walks through stats (the dot allocation), ancestry, societies, backgrounds, starting words and a review showing the XP cost. One Childhood, one Job and one Leisure background are required and free; further backgrounds and societies cost their XP. Finishing puts everything on the character and spends the XP. Afterwards only the GM can re-run it (from the sheet header); re-running replaces the earlier picks and refunds them.
- **Ancestries cost no XP.** Advanced ancestry features are now talents: a talent can *Require ancestry*, and only characters of that ancestry can take it. The Talents tab says which ancestry a locked talent needs. Ancestries have a stable *Ancestry id* that talents point at; the old *Advanced* and *XP cost* fields on ancestries are gone.
- **Respec.** Once a character is created, re-running the dot allocation spends respec points (setting *Respec cost*, default 1). A GM can waive the cost.
- **New settings:** *Starting XP* (default 100), *Starting words* (default 0: words come only from talents) and *Respec cost*.

## 0.1.2
- **Encounter Manager stack:** entries that have resolved now say *Resolved* instead of *Submitted*, and interrupted entries say *Interrupted* in the same badge.
- **Fix:** a stack entry's title ("Name: Action") stays on one line instead of breaking before the colon.

## 0.1.1
- **No skills or levels.** Talents are the only progression; XP is spent on talents. The Skill item type is removed.
- **XP thresholds instead of levels.** The sheet shows XP earned, spent and left, and the XP threshold reached with the XP needed for the next. Earned XP counts whether spent or banked. The ten thresholds are game settings (default 100 to 5500). Track pips and break points, the momentum ceiling and word slots grow with the threshold the way they grew with level.
- **Compendium content without importing.** Actions, words, statuses and talents in the system's compendiums are available in every world straight away: the Act and Declare windows, the Talents tab and status effects read them directly. Nothing needs importing, and updates arrive with each new version. A world copy of an entry overrides it in that world.
- **Fix:** a word chosen in the Act or Declare window no longer drops out when the character owns their own copy of it.
- **Any word, at a price.** Every word now has two costs for characters who don't know it: a *Roll penalty* (−1, −2…) and a *Tier downgrade* (tiers off the rolling stat). A word can have either or both. Anyone can use any word with an action; not knowing it applies its costs to that roll ("Acrobatic (not known) −2", "−1 tier"), shown in the Act window and on the roll card. Characters know their base words, the words on their sheet, and the words their talents grant (*Grants words*). Talents' *Grants actions* make trained actions available.
- **Talent levels.** A talent can require any number of other talents (*Also requires* on the talent sheet), of any tier. A talent with several levels is a chain: level 2 requires level 1. The talent graph shows these and flags loops.
- **Talents.** A Talents tab on the character sheet shows the talents a character has and every talent they could take, with its XP cost. Locked talents say exactly what they still need. Taking a talent spends its XP; removing one can refund it. The GM can grant a locked talent.
- **Talent editor.** Talent sheets pick their prerequisites from lists of the right tier, flag problems in the prerequisite graph, and show the authoring principles. A Talent graph window (talent sheet or Vocabulary Editor) shows every talent as trees by domain.
- **Conditional effects.** Talents can give tier shifts (or dice) when something happens in an encounter: an action used, being targeted, a hit or miss, a break point, a scene track change, a status, round start, and more. Each effect is built from lists and previewed as a plain sentence. Active effects show in chat, in the Encounter Manager (the GM can remove them) and on the sheet, and every roll card lists the talent effects that changed it.
- **Delayed effects.** An on-hit, on-miss or on-resolution effect can be delayed by some rounds (the hourglass box on its row). Applying it schedules it; it takes effect at the start of the round it falls due. Pending ones show in the Encounter Manager, where the GM can cancel them.
- **Teams and betrayal.** An optional team label per participant in the Encounter Manager. The same team is an ally; an opposing team is an enemy. Participants with no team are in free for all: stealthed or undeclared characters have no allies or enemies and are nobody's enemy. Changing a team (a reveal, a betrayal, slipping into stealth) is a talent trigger of its own. A new **Change team** effect lets actions, words and statuses do it: set a named team, drop into free for all, recruit the target to your team, or join the target's team.

## 0.1.0
- **First test build.** Character and NPC sheets with the dot allocator, three pip tracks with break points, momentum, and the 3d20 keep-one roll with buff and debuff dice.
- **Vocabulary.** Actions, words, statuses, talents and skills with a typed effects editor and tag chips; the Vocabulary Editor (Items sidebar) with JSON import and export; the Act window to build an action from words and see its cost, dice and chance before rolling.
- **Encounters.** The Encounter Manager (Combat sidebar): participation, declaration in momentum order, the Slow re-confirmation cascade, Fast, Duelist, resolution top to bottom with outcome buttons, Charge, Taxing, Determined, Inevitable, and the surrender check. Players get their prompts as pop-up windows.
- **Optional card deck** (world setting): personal 52-card decks per encounter, poker hands, marked cards.
- **Compendium updates reach your world.** When a new version changes compendium entries, items your world took from those compendiums (in the Items sidebar and on characters) are updated the first time the GM loads the world. Items you edited in the world are left alone and listed for review in Vocabulary Editor → Sync from compendiums. A skill's rank, a status's remaining rounds and worn armor are kept.
- The *Test Fixtures (not canon)* compendium has Strike, Grapple, Recuperate and four words to try it with.
