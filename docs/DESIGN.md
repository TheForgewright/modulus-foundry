# Modulus — Foundry VTT Implementation Design

**Handoff document for Claude Code** · v0.1 · 2026-11-16
Design authors: TheForgewright and DrexMartell. Compiled from the original system document, the design Discord, and a long design session.

---

## 0. Read this first

### 0.1 Status labels

| Label | Meaning | What you do |
|---|---|---|
| **[RULE]** | Decided. | Implement exactly. |
| **[DRAFT]** | Decided in principle, details may change. | Implement the stated default behind a world setting (§16). |
| **[OPEN]** | Not decided. | Do not invent rules. Provide a manual GM control, or a setting with the placeholder default shown, and keep it listed in `OPEN_QUESTIONS.md` (seed it from Appendix D). |
| **[IMPL]** | Implementation advice. | Deviate if you find a better fit. |

### 0.2 Working agreements

1. **Rules and implementation are separate on purpose.** Parts 1 (§2–§10) is the game. Part 2 (§11–§18) is how to build it. Keep the rules engine as pure JavaScript with zero Foundry imports so it can be unit-tested and so rule changes never touch UI code.
2. **Content is human-authored.** Do not write talents, trees, words or actions beyond the test fixtures in §17.3. Build the tools designers author content with.
3. **This document wins over older material.** The original system `.docx` and the design Discord contain superseded rules. Appendix A lists every conflict and how it was resolved.
4. **Verify Foundry APIs against current documentation before using them.** API names in Part 2 come from memory and may be stale. Target the latest stable Foundry release.
5. **Do not resolve [OPEN] items in code on your own.** Ask the designers.
6. **Numbers in older sources are unreliable.** Use the exact tables in Appendix B, which come from full enumeration of the dice, not estimates.

### 0.3 Platform recommendation

Build this as a Foundry **game system** (id `modulus`), not an add-on module. It defines its own actor and item types, sheets, dice behavior and combat flow, and add-on modules have limited ability to define document types. Details in §11.

---

## 1. Product summary

Modulus is a tabletop RPG in which physical, mental and social conflict run on one engine. The software must provide:

- **Character sheets**: a 3×3 stat grid set with dots, three HP tracks (pips), momentum fields, statuses, talents.
- **A vocabulary editor** so designers author actions, words, tags, statuses and talents in-app, with JSON import/export.
- **A roll engine**: 3d20, keep one die by proficiency tier, with buff and debuff dice.
- **An encounter stack**: GM-hosted, multi-client. Players declare lowest momentum first, the stack resolves top to bottom.
- **Persistent encounters** (relationships, investigations) alongside short ones.
- **An optional card-deck subsystem** (§10).

Design pillars, in the designers' words where possible:

- **Momentum is initiative and economy.** High momentum acts first and declares last (with the most information).
- **Consistency, not size.** The 3d20 keep-one system makes proficiency change how reliably you do well, not how big the number is.
- **Dice, not bonuses.** "Gotta get out of the bonus mentality." Avoid numerical bloat; a natural 20 should mean something.
- **One engine, three tracks.** Physical, mental and social encounters use identical machinery. Only vocabulary differs.
- **Words build actions.** A declared action is a core action plus modifier words. Strategy lives in word choice and momentum, not in a spell list.

---

# PART 1 — RULES

## 2. Resolution

### 2.1 The core roll [RULE]

Roll 3d20 and keep one die, chosen by the roller's proficiency tier in the relevant stat.

| Tier | Keep | Mean of kept die |
|---|---|---|
| Tertiary | lowest | 5.51 |
| Secondary | middle | 10.50 |
| Primary | highest | 15.49 |

An action succeeds if **kept die + any gated flat bonus ≥ DC** ("meet or beat").

**There are no critical hits or fumbles.** A natural 20 is simply the best possible kept die. Do not implement crit or fumble mechanics.

### 2.2 Dice modifiers: buff dice and debuff dice [RULE]

All normal bonuses and penalties are expressed as extra dice.

- **Buff die**: roll one extra die and drop the lowest.
- **Debuff die**: roll one extra die and drop the highest.

General form, for `B` buff dice and `D` debuff dice:

```
n      = 3 + B + D
sorted = n dice sorted ascending
kept3  = sorted.slice(B, n - D)        // exactly 3 dice remain
result = kept3[0] (tertiary) | kept3[1] (secondary) | kept3[2] (primary)
```

- **Compression** is simply `B=1, D=1` (5d20, drop highest and lowest). It pulls every tier toward the mean. Designers use it as a variance-flattening effect.
- **Stacking [DRAFT]**: buff and debuff dice are additive and do not cancel each other (one of each is compression). No cap defined.
- A **tier shift** (+1 or −1 tier) is a separate, much larger effect (§2.5).

Approximate effect on the kept die (exact tables in Appendix B):

| Effect | Tertiary | Secondary | Primary |
|---|---|---|---|
| One buff die | +3.0 | +2.0 | +1.0 |
| One debuff die | −1.0 | −2.0 | −3.0 |
| Compression (1 buff + 1 debuff) | +1.7 | 0.0 | −1.7 |
| One tier up or down | ±5.0 | ±5.0 | ±5.0 |

Consequences designers rely on: buff dice help low tiers most, debuff dice hurt high tiers most, and a debuff die takes a primary's chance of a natural 20 from 14.3% to 1.4%.

### 2.3 Defense and target numbers [RULE with an [OPEN] value]

**Defense is fixed, not rolled.** The attacker rolls; the defender does not. The DC is looked up from the **defender's tier in the action's target stat**.

| Defender's tier in the target stat | DC (preset A, default) | DC (preset B, candidate) |
|---|---|---|
| Primary | 14 | 13 |
| Secondary | 11 | 11 |
| Tertiary | 8 | 9 |

**[OPEN]** The designers have not chosen between presets A (14/11/8) and B (13/11/9). Expose all three DC values as world settings, default to A. Secondary-vs-secondary is exactly 50% under both, which is the intended anchor. See Appendix B for the full hit-rate tables.

**Unopposed tasks [OPEN]**: no fixed rule yet. Provide a GM-entered DC field on the roll dialog. Suggested default 11 (a secondary roller succeeds exactly 50%).

**Contested rolls [OPEN]**: not defined. Do not build an opposed-roll mechanic; give the GM a manual "roll for target" button if needed.

### 2.4 Rolling stat and target stat [RULE]

Every action defines two stats:

- **`rollStat`**: the attacker's stat (which die they keep).
- **`targetStat`**: the defender's stat being tested (which sets the DC).

They need not be in the same domain. Words can override either. This produces the intended rock-paper-scissors: a boxer tests the target's Finesse (power vs finesse); an aikidoka tests the target's Resilience with finesse (finesse vs resilience). Examples:

- Base grapple: Power vs Power.
- A grapple modified by entry and control words: Power vs Resilience, with a success condition that restricts the target.

### 2.5 Bonus philosophy [RULE]

- **No passive bonuses.** A bonus may exist only if gated by (a) a successful prior action against an uncertain situation, or (b) a momentum expenditure.
- **Prefer dice to flat numbers.** The preferred bonus language is buff dice, debuff dice, tier shifts and rerolls.
- **Flat bonuses that do exist** (for example Duelist, §7.5) are gated and small. The unknown-word penalty (§6.2) is a flat penalty.
- **Skills are an exception [RULE, 2026-11-18]:** a skill adds its rank as a flat bonus to rolls of the actions it modifies (§3.6). It is one of the few flat bonus sources, and is not gated.
- A sheet-level integer `bonus` per stat exists as a v0.1 placeholder the designers said "will change later". Implement it, default 0, hidden behind an "advanced" toggle, and do not build features on it.
- Round down by default wherever a calculation produces a fraction.

---

## 3. Characters

### 3.1 The 3×3 stat grid [RULE]

Three **domains** (also called tracks): Physical, Mental, Social. Three **expressions**: Power, Finesse, Resilience. Nine stats = domain × expression. Stat keys: `physical.power`, `mental.finesse`, and so on.

Default display labels, taken from the original doc (cosmetic and configurable; the designers say names beyond the grid concepts are unimportant):

| | Physical | Mental | Social |
|---|---|---|---|
| **Power** | Strength | Intelligence | Presence |
| **Finesse** | Dexterity | Wits | Guile |
| **Resilience** | Resistance (a.k.a. Endurance) | Discipline | Poise |

### 3.2 Setting the stats with dots [RULE]

This replaces the original 13-point buy.

1. Pick one **domain** and one **expression**.
2. Their intersection gets **2 dots**.
3. Every other stat on that domain's row and that expression's column gets **1 dot** (4 stats).
4. Stats on neither get **0 dots** (4 stats).
5. Add **one free dot** to any stat except the intersection.

Tier from dots: **2 = primary, 1 = secondary, 0 = tertiary.**

```
Example: Physical Power, free dot on Social Power

            Power   Finesse   Resilience
Physical     ●●       ●          ●
Mental       ●        ○          ○
Social       ●●       ○          ○        (free dot raised Social Power 1 → 2)
```

Resulting shapes:

| Free dot placed on | Result |
|---|---|
| A tertiary (0 → 1) | 1 primary, 5 secondary, 3 tertiary |
| A secondary (1 → 2) | 2 primary, 3 secondary, 4 tertiary |

The base shape before the free dot is always 1 primary, 4 secondary, 4 tertiary. Validate: exactly one domain and one expression chosen, free dot not on the intersection, no stat above 2 dots.

Store the allocation choices (`domain`, `expression`, `freeDot`) and derive dots and tiers from them.

### 3.3 Effective tier: defeat degradation [DRAFT]

When a character is **defeated on a track** (§4.5), they drop in tier on **all rolls** (and by default on defense; see settings) until that track recovers.

- Each defeated track = one step down: primary → secondary → tertiary.
- A step taken while already tertiary adds **one debuff die** instead ("negative dice on top").
- Example: secondary physical, defeated on mental → treated as tertiary physical.
- Multiple defeated tracks compound.

Provide one function, `effectiveTier(actor, statKey) → { tier, extraDebuffDice }`, used by both rolling and defense lookups. It sums defeat degradation and all active talent tier shifts from conditional effects (§8.1), then clamps; steps below tertiary become debuff dice.

### 3.4 Changing stats [OPEN]

Stats rarely change. The designers describe "one-roll changes" to primary/secondary/tertiary and "occasional respec points, but you don't get more of them." Implement a `respecPoints` counter on the sheet (GM-adjustable, default 0) and a manual way to re-run the dot allocator. Define no automatic level-up retraining; the original "move up to 2 points per level" belonged to the superseded point-buy. Default in use: a respec clears the allocation to choose again; it is free until character creation is finished, then costs `respec.cost` respec points (setting, default 1), which a GM may waive.

### 3.5 XP and progression [RULE, 2026-11-19]

**There are no levels and no skills.** The whole system is built from talents (§8).

- **XP is an expendable resource.** A character has XP to spend; taking a talent spends its XP cost.
- **Everything is buildable:** a character is their dot allocation plus the talents they have bought.
- **Talents with several levels** are separate talents chained by prerequisites: level 2 is its own talent that requires level 1, level 3 requires level 2, and so on. Each level has its own XP cost (the same or more than the previous level).
- **Superseded:** the original level table (100 × level XP), level-0 characters, and the "XP counts what was spent on skills and features" model.
- **XP thresholds replace levels [RULE, 2026-11-19, may be removed later].** There are 10 thresholds of **earned** XP (spent or banked, it all counts), configurable as world settings (defaults 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500). A character's *threshold* is how many they have reached. Wherever the rules used the level, they use the threshold: track pips and break points (§4.2, §4.3: pips per threshold × threshold, one segment per threshold), the momentum ceiling (§5.1: 5 + threshold) and word slots (§6.7: 2 + threshold ÷ 4).

### 3.6 Skills [REMOVED, 2026-11-19]

Skills are removed. Talents are the only progression. The skill item type is gone. **Words come from talents [RULE, 2026-11-19]:** a character knows the base words (everyone has them) and the words their talents grant (`grantsWords`); trained actions likewise come from talents (`grantsActions`).

### 3.7 Creation aspects [carried]

Content-authored item types with XP cost fields and effect lists:

- **Ancestry**: one minor boon, one major boon, one minor bane. Ancestries cost no XP. **[RULE, 2026-11-21]** Advanced ancestry features are talents with the character's ancestry as a prerequisite; they are bought with XP like any talent. This supersedes "advanced ancestries cost 100–500 XP per level".
- **Society**: where you hail from; anything from a kingdom to a group of friends who made a pact. A character can belong to several, each with its own benefits.
- **Background**: required one Childhood, one Job, one Leisure background; extras cost XP.
- **Remaining XP**: spent freely.

**Creation flow [built 0.1.3]:** a Character creation window (character sheet) steps through stats (dot allocation), ancestry, societies, backgrounds, starting words (only when `creation.startingWords` > 0) and a review with the XP cost. Finishing sets the allocation, copies the picks onto the character and spends their XP. A GM can re-run it; the earlier picks are replaced and refunded. New characters start with `creation.startingXP` (default 100, [OPEN #81]).

Starting words **[RULE, 2026-11-21]**: the number of words a character picks at creation is a world setting (`creation.startingWords`, default 0), so the designers can test starting words against words linked only to talents. Base words are known by everyone and don't count. This supersedes the starting word packs (2 packs for the primary skill, 1 per secondary, 1 across the tertiaries), which were written for skills.

---

## 4. Tracks and hit points

### 4.1 Three tracks [RULE]

Each character has three independent HP tracks: **physical, mental, social**. Each is a row of **pips**.

### 4.2 Pips per level [DRAFT]

A track's tier is the tier of **that domain's Resilience stat** (physical track ← physical.resilience, and so on). Pips per level:

| Track tier | Pips per level |
|---|---|
| Primary | 4 |
| Secondary | 3 |
| Tertiary | 2 |

Total pips = pips per level × level. **[OPEN]** level 0 would have no pips; use `max(level, 1)` until decided.

Design intent: damage numbers stay small. A hit or failed save is **1 pip** base, scaled by level, words and talents. **[OPEN]** how it scales; default to manual GM entry with a 1-pip button.

### 4.3 Break points [DRAFT]

Pips are grouped into one segment per level. The **last pip of each segment is a break point** (it is its own pip).

- **Short rest** restores all lost pips in the current segment, unless that segment's break point has been reached.
- Once a break point is reached, only a **long rest** (restores one level's segment) or **magic** can heal it.
- Reaching a break point lets the character **change their scene track** (§7.10).
- **[OPEN]** any further effect of reaching a break point. Flag break points distinctly in the UI and attach no automatic penalty.

### 4.4 Overflow [carried]

Damage taken in a track that is already depleted is spent from the character's remaining tracks of their choice. A character with all three tracks depleted is out. A character can also be taken out by a successful action against their passive resistance in a track, or by certain momentum maneuvers (content-defined).

### 4.5 Defeat on a track [DRAFT]

A track with no pips left is **defeated**. Apply the matching status (named for fiction; the consequence is GM-adjudicated):

| Track | Defeat state | Typical fiction |
|---|---|---|
| Physical | Down / incapacitated | Knocked out, unable to act |
| Social | **Lost the Room** | Lost standing, access, goodwill; may be asked to leave |
| Mental | **Discredited** | Credibility collapsed; handled with suspicion; may be restrained or ignored |

Neither social nor mental defeat is "worse" than the other; severity depends on context. Mechanically, the defeat status causes tier degradation (§3.3). It lasts until the track recovers pips or the GM clears it. Winning back a lost room or credibility is a fiction-level action; offer the GM a one-click clear.

Defeat is not automatic removal from the encounter; see the surrender check (§7.9).

---

## 5. Momentum

### 5.1 Fields on every character

| Field | Default | Notes |
|---|---|---|
| `starting` | 3 | Value at encounter start. Original doc: base 3. |
| `gainPerTurn` | 1 (placeholder) | Added each round. The designers said form-fill integer; default not chosen. |
| `current` | = starting | Stored on the sheet, read at the start of each round. |
| `ceiling` | 5 + level | Derived. Original doc: 5 at level 0, +1 per level. |
| `resistance.physical` / `.mental` / `.social` | 0 | See §5.3. |

### 5.2 Rules

- Momentum is the **initiative value** (§7) and the **spendable resource**.
- Momentum is **encounter-scoped**: each encounter instance has its own momentum per participant. A persistent social encounter (a relationship) has momentum that resumes where it left off (§7.11).
- Non-persistent encounters reset to `starting` when the scene ends.
- Gain: at the start of each round after the first, `current = min(ceiling, current + gainPerTurn)` **[DRAFT]**.
- **Negative momentum is allowed.** A character at or below zero may only declare actions with the **Recovery** tag. Every character has the universal **Recuperate** action (§6.8). **[OPEN]** whether a floor exists.

### 5.3 Momentum resistance [RULE]

Resistance is **defensive**. It does not discount your own costs. It **increases the momentum cost for other people** trying to affect you.

An action's total cost:

```
totalCost = action.momentumCost
          + Σ word.momentumModifier                  (may be negative)
          + target.momentum.resistance[domain]       (only if the action has the `offensive` tag
                                                      AND the target is another actor)
```

- **[OPEN]** which resistance track applies. Default: the **domain of the action's `targetStat`** (what is being affected). The earlier alternative was the action's own domain tag.
- **[OPEN]** cost floor. Default: total cost cannot go below 0.
- **[OPEN]** when cost is spent. Default: validate affordability at declaration, **deduct at resolution**, so declaration order (fixed from start-of-round momentum) is never disturbed. Cancelled or interrupted entries spend nothing.
- The original doc's armor "reduced momentum of the attacker" is treated as armor contributing to resistance (§9).

---

## 6. Vocabulary: actions, words, tags, statuses

### 6.1 Actions (core actions) [RULE]

The verb. What you fundamentally do. Fields:

| Field | Type | Notes |
|---|---|---|
| `name`, `description` | string | |
| `rollStat`, `targetStat` | stat key | Defaults; words can override. |
| `momentumCost` | signed int | Base spend. Negative = grants momentum. Base cost is usually 1. |
| `tags` | `{name, value}[]` | §6.4 |
| `effects` | Effect[] | §6.3 |
| `rolls` | bool, default true | Self-effects and Reactions may not roll. |
| `trained` | bool | If true, only available once granted by a talent or skill. |
| `groups` | optional `{tree, tier1, tier2, tier3}` strings | Organisational labels for the vocabulary editor and export (carried requirement). |

### 6.2 Words [RULE]

Modifiers declared with an action. A word is a **delta object**: it describes changes to the base action; most fields are empty on any given word.

| Field | Type | Notes |
|---|---|---|
| `name`, `description` | string | |
| `momentumModifier` | signed int | Added to cost. Always applies, regardless of target. |
| `tags` | `{name, value}[]` | Added to the action. |
| `effects` | Effect[] | §6.3 |
| `penalty`, `tierDowngrade` | int | **[RULE, 2026-11-19]** Anyone may attach any word to an action; the word declares what they are trying to do. A character who does not **know** the word takes its costs on the roll: `penalty` as a flat penalty (−1, −2…), `tierDowngrade` as tiers off the rolling stat (below tertiary, each step is a debuff die, §3.3). A word may carry either or both; **[DRAFT]** which to keep is decided by playtesting. Knowing the word negates both. |
| `baseWord` | bool | `baseWord` = every character knows it. A character also knows the words on their sheet and the words their talents grant. (`trained` is removed: knowing replaces it.) |
| `groups` | as for actions | |

**Unknown words [RULE, 2026-11-19]:** for example an *Acrobatic* strike (vaulting an obstacle, leaping through the air) is open to everyone, but a character without *Acrobatic* in their vocabulary takes its penalty on the roll. This is one of the few flat modifiers, alongside Duelist (§2.5).

Words describe *how* an action is done ("Planted", "Charging"). **Test for a good word:** can you put it before a core action and have it make physical sense? Words are not spells; a "spell" is a mental skill's words combined with a core action.

Naming convention (designer preference, not enforced): single words, present-participle or adjective style.

### 6.3 Effects [IMPL, schema guidance; capabilities are RULE]

Actions, words, talents and statuses all need to be able to change almost every mechanical layer. Model this as a list of typed effects with a trigger. Required capabilities:

| Layer | Capability |
|---|---|
| Economy | change momentum cost; grant or remove momentum for self or target; draw cards (§10) |
| Resolution | override `rollStat` / `targetStat`; **buff/debuff dice** on this action's roll; **tier shift** (e.g. treat a secondary as primary for this roll; impose a tier degrade on attackers); set a fixed DC |
| Stack | add tags (including Slow/Fast/Interruptible/Charge); modify submission state |
| Mobility | movement (free text is acceptable) |
| Outcomes | on hit / on miss / on any resolution: apply or remove a status on self or target; change pips; momentum change |
| Restrictions | forbid actions carrying a given tag until a break condition (example: a successful joint-lock grapple stops the target using any action tagged `two-handed` until they break the grapple) |
| Notes | free-text outcome for the GM to adjudicate |

A suggested shape:

```jsonc
{ "trigger": "declare|finalize|onHit|onMiss|onResolve|while",   // "while" = passive while a status/talent applies
  "op": "rollStat|targetStat|cost|dice|tierShift|addTag|status|momentum|pips|restrict|draw|note",
  "args": { }, "to": "self|target|room" }
```

### 6.4 Tags [RULE]

A tag is `{ "name": string, "value": int }`. Value 0 means "no intensity". Tags have two jobs:

1. **Labels** so features can target groups of actions precisely: a talent that improves "all `strike` actions" affects exactly those. `strike`, `control`, `magic`, `two-handed` and similar are **labels only** with no engine behavior.
2. **Engine behaviors** for the specific tags below.

Keep a tag registry (name, description, `engine` flag) for autocomplete in the editor. Custom tags are free.

**Engine-aware tags:**

| Tag | Status | Behavior |
|---|---|---|
| `slow X` | RULE | Effective momentum = momentum − X. Declarer becomes **Locked**. Triggers re-confirmation cascade (§7.4). |
| `fast X` | RULE | Effective momentum = momentum + X. No cascade. |
| `reaction` | DRAFT | Cancels the actor's own action and puts the reaction on the stack in its place (§7.6). |
| `interruptible X` | DRAFT | Marks an action as disruptible; X (1–3) = how hard it is to interrupt. Mechanic [OPEN] (§7.6). |
| `duelist X` | RULE | See §7.5. |
| `charge X` | RULE | Action must be declared X rounds in a row before it resolves (§7.7). |
| `recovery` | RULE | Usable at zero or negative momentum; almost always returns momentum. |
| `inevitable` | RULE | Each turn the action is taken without success, every other combatant is treated as having 1 less momentum per attempt (cumulative; resets on success). |
| `taxing X` | RULE | After taking a Taxing action, X rounds must pass before another Taxing action. |
| `determined X` | RULE | If the action does not succeed, refund X momentum. |
| `offensive` | RULE | Target's momentum resistance is added to cost (§5.3). |
| `aid X`, `hinder X` | DRAFT | Targets another entry below you in the stack: `aid` grants it X buff dice, `hinder` gives it X debuff dice. Default X = 1. |
| `delayed` | OPEN | "Goes off later in the round." Default: resolves after all non-delayed entries. |
| `armor penetrating X`, `armor ineffective X` | OPEN | Store and display; no behavior until the designers define the armor interaction (§9). |
| `draw`, `cashout` | optional | Card deck (§10). |
| `draining X` | OPEN | Listed as "pending, need to discuss" in the original doc. Do not implement. |

### 6.5 Statuses [DRAFT]

Persistent conditions on a character, distinct from tags (tags live on a stack entry for one resolution; statuses persist across rounds or scenes).

| Field | Notes |
|---|---|
| `name`, `description` | |
| `duration` | `untilNextTurn` \| `rounds:n` \| `scene` \| `encounter` \| `persistent` |
| `track` | physical / mental / social / all |
| `effects` | Effect[], usually `while` triggers (dice, tier shift, restrictions) |
| `tierDegrade` | bool, does this status degrade tiers while active |
| `recovery` | what clears it besides duration (free text; `breakContest` with rollStat/targetStat for grapple-like holds) |
| `context` | optional: the room or relationship it applies to |

`Exposed X` is a status: until the start of its owner's next turn, enemies gain X on rolls targeting them. **[OPEN]** whether "gain X" is a flat bonus (as written in the Discord, defensible because it was earned by a prior successful action) or X buff dice. Implement `exposedMode = flat | dice`, default `flat`.

### 6.6 Assembling a declared action [RULE]

At declaration the engine builds the resolved action:

1. Start from the core action's `rollStat`, `targetStat`, tags, cost, effects.
2. Apply words in declared order. **[OPEN]** when two words override the same stat: default last declared wins.
3. Tags: union. **[OPEN]** same-name tags with values: default sum.
4. Cost per §5.3.
5. `effectiveMomentum = actor.current − slow + fast`.
6. Collect dice effects: buff/debuff from words, statuses, scene-track bonus (§7.10), focus bonus (§6.7), extra-word penalty (§6.7).
7. DC is looked up at **resolution**, not declaration, because the target's state can change.

### 6.7 Word slots [OPEN, with placeholders]

- Base characters get **2 words** per declared action.
- Extra words from level: the designers wrote both "1/4 your level" and "every even level another word". Default `maxWords = 2 + floor(level / 4)`; alternative `2 + floor(level / 2)`. Expose as a formula setting.
- Each word beyond the second carries a cumulative penalty to all rolls of that action. Magnitude undecided. Placeholder: one debuff die per extra word.
- **Focus bonus:** choosing not to use all word slots gives a bonus to all rolls in that action. Magnitude undecided. Provide the hook, default **off**.
- A character with fewer words is typically more reliable; the Traditionalist-style play (one word, high consistency) is an intended identity.
- **Rejected ideas, do not implement:** holding unused word slots in reserve for later or reactive use, and a separate reaction phase. Reacting is constrained by momentum order instead (§7.6).

### 6.8 Universal actions

- **Strike** [RULE]: everyone has it.
- **Grapple** [DRAFT]: probably free for everyone. Base Power vs Power. What you do from a grapple (Lock, Throw, Disarm and so on) is trained.
- **Recuperate** [RULE]: tag `recovery`; resets momentum to 3. The original check was Difficulty 10 using the physical-resilience skill; under the new scale use the default task DC unless the designers say otherwise.

Everything else (including all trained actions and all words beyond the base words) is content.

---

## 7. Encounters

### 7.1 Encounter instances [RULE]

An **encounter instance** is: participants, per-participant momentum, one stack, a round counter, optional parent. Nothing in the definition requires combat. Instances can be:

- **Short** (a fight, a chase, an argument), reset at scene end.
- **Persistent / extended** (§7.11): momentum resumes next time. Three kinds, one per domain: **Relationship** (social), **Investigation** (mental), **Ordeal** (physical).
- **Nested or overlapping**: a physical brawl running inside a trial or investigation. Each instance has its **own momentum track**; they do not share or contaminate. Statuses live on the character, so they carry across instances.

Optional label `scale`: macro (investigation, intrigue), meso (scene), micro (round). It carries no mechanics.

### 7.2 Scene types (labels) [DRAFT names]

| Scene type | Track | "Who controls…" |
|---|---|---|
| Action | physical | space |
| Drama | social | relationships |
| Intrigue | mental | truth |

These are descriptive. A single stack can mix tracks freely because ordering uses momentum only and each action carries its own stats.

### 7.3 Round flow [RULE]

1. **Round start.** From round 2, apply momentum gain (§5.2).
2. **Participation request.** The GM asks every player which of their characters take part this round; each reports its current momentum (read from the sheet). The GM supplies NPCs and their momentum. NPCs and PCs go through the same flow.
3. **Order.** Sort participants by current momentum **ascending**. Ties: each tied participant rolls **1d20**, re-rolling on equal results. **Lower roll declares earlier. The winner declares later and resolves earlier.**
4. **Declaration.** In that order, each participant declares **one action** (more only if a feature says so): core action + up to `maxWords` words + target (an actor, an entry already on the stack, self, or none). Entries build the stack **bottom to top**: the slowest declare first, with the least information; the fastest declare last, seeing everything below them. If a declaration carries Slow, run the cascade (§7.4). Fast entries are inserted higher without a cascade.
5. **Finalization.** Duelist phase (§7.5).
6. **Execution.** Resolve **top to bottom** (highest effective momentum first; ties by rolloff, winner first). §7.8.
7. **Surrender check** (§7.9).
8. **Round reset.** Clear entries, tick statuses and cooldowns, keep Charge counters, go to 1.

### 7.4 Slow and Fast [RULE]

**Fast X**: effective momentum = momentum + X. Inserted above the current stack top with no cascade. Entries can only be reacted to by things *above* them, so a Fast action is harder to counter.

**Slow X**: effective momentum = momentum − X (momentum is "treated as X lower for initiative").

When a Slow action is declared, its **insertion point** is its effective momentum. Re-confirm anyone who:

1. has **already submitted** an action this round, **and**
2. is **not Locked**, **and**
3. now sits **above** the insertion point in resolution order (effective momentum higher, or equal and winning the tiebreak).

Rules:

- Re-confirmation is **not** decided by momentum value alone. Two characters at the same momentum can be in different states: the rolloff winner who has not declared yet is **not** prompted; the loser who already declared **is**.
- Re-confirmation pre-fills the player's original choice; they may change it. Stack building does not continue until all prompted players confirm.
- **Locked:** whoever declared a Slow action is Locked. They cannot change it and **auto-confirm** whenever a cascade passes them.
- If a re-confirming player switches to a Slow action, that triggers a new cascade from the new insertion point. Locked entries are auto-confirmed and skipped.
- **[OPEN]** a cascade depth cap. Default none, with a loop guard of 25.

Submission states per entry: `PENDING`, `SUBMITTED`, `LOCKED`, `CHARGING`.

```
onDeclare(entry):
  if entry has slow:
    entry.state = LOCKED
    ins = entry.effective
    prompt = [e for e in stack if e.state == SUBMITTED and e.effective above ins]   # LOCKED/CHARGING excluded
    for e in prompt (ascending): reconfirm(e)        # may recurse into onDeclare(e')
  elif entry has fast: insert(entry)                 # no cascade
  else: insert(entry)
```

### 7.5 Duelist X [RULE]

Fires once, automatically, after the last declaration and before execution. In descending effective-momentum order among Duelist entries, each actor sees the full stack and may **lower their entry's effective momentum by any amount from 0 to X**. The amount lowered is added as a **flat bonus to that entry's resolution roll**. Better against small groups or one predictable opponent; favors fast characters.

### 7.6 Reactions, interrupts, aid and hinder

**There is no separate reaction phase.** A character can only react to entries **below** them in the stack (declared earlier, resolving later), because those are the ones visible to them. Anything above them has not been declared yet or cannot be countered.

- **Reaction [DRAFT]:** the tag means "this action replaces my own planned action and acts on another entry already on the stack." The actor skips their normal action. Reaction effects apply without an opposed roll unless the action says otherwise. Replacing an already-submitted entry is also allowed during a re-confirmation prompt.
- **Interrupt [OPEN]:** an action aimed at an entry tagged `interruptible X`. The interrupter must act from above the target and "sacrifice their turn". How X is paid (momentum difference, extra momentum, a DC) is undecided. Default: GM-adjudicated; provide an "Interrupt" button on a stack entry that cancels it and records who did it.
- **Aid / Hinder [DRAFT]:** see tag table (§6.4). A pure reaction does not need an opposed roll. A normal action that carries aid, hinder or interrupt needs its own roll to succeed first.

### 7.7 Other stack-state tags

- **Charge X:** the entry occupies the actor's declaration each round (state `CHARGING`, visible to opponents with a counter) and resolves once it has been declared on X consecutive rounds. Missing a round resets the counter. **[OPEN]** whether it resolves on the Xth declaration (default) or the round after.
- **Taxing X:** track a per-actor cooldown.
- **Determined X:** on a miss, refund X momentum.
- **Inevitable:** track consecutive failed attempts per actor/action; every other participant's momentum is treated as that many lower for ordering.
- **Recovery:** the only tag usable at ≤ 0 momentum.

### 7.8 Resolving an entry

```
resolve(entry):
  skip if cancelled/interrupted
  if CHARGING and not due: advance counter; return
  if entry.action.rolls:
    {tier, extraDebuff} = effectiveTier(actor, entry.rollStat)
    buff   = word/status/track/tierShift-derived
    debuff = ... + extraDebuff
    kept   = rollKept(tier, buff, debuff)
    total  = kept + duelistBonus + gatedFlatBonuses
    dc     = dcFor(effectiveTier(target, entry.targetStat))     // or entry.fixedDC
    hit    = total >= dc
  deduct totalCost (§5.3)
  apply onHit or onMiss effects  (offer to GM as buttons unless autoApply)
  determined / taxing / inevitable bookkeeping
```

Damage and effects are **not** auto-applied by default: the chat card shows outcome buttons and the GM confirms. Auto-apply is a setting.

### 7.9 Surrender check [DRAFT]

At the end of each round, for every participant, compute flags: any defeated track, momentum below zero, all tracks depleted. The GM decides whether the character continues, yields, or is out. The system never removes a character automatically.

### 7.10 Scene track choice and bonus [DRAFT]

Each participant chooses one scene track (Action, Drama or Intrigue; physical, social or mental) when an encounter starts.

- Their **declared actions** whose `rollStat` is in that domain get **one buff die** (**[OPEN]** magnitude; "bonus amount tbd"). Off-track actions are unmodified, with no penalty. **Defense is not affected.**
- When a character **reaches a break point** (§4.3) they may choose a new scene track.

### 7.11 Extended encounters: relationships, investigations, ordeals [DRAFT]

An **extended encounter** is a persistent instance whose momentum is not reset between sessions. It is one mechanism with a `kind` label, one kind per domain:

| Kind | Domain | Typical use (illustrative, not canon) |
|---|---|---|
| **Relationship** | Social | Standing between characters; a reputation with a person or faction |
| **Investigation** | Mental | A case, mystery, conspiracy or research project pursued over many sessions |
| **Ordeal** | Physical | A long trek, siege, endurance trial, survival situation or gauntlet |

- The `kind` is a label with no engine difference in v1. It sets the default domain shown in the UI, filters the Encounter Manager list, and is available to triggers and conditions (§8.1) as `params.kind`.
- Participants are the characters involved plus, where there is no other character, a GM-controlled **subject** entry (the mystery, the wilderness, the trial) that holds momentum and takes the opposing side. **[OPEN]** whether a subject has HP tracks or only momentum; default momentum only, with GM-adjudicated outcomes.
- Like any instance, an extended encounter can be nested in or run alongside others (§7.1). A single investigation may spawn short action encounters; statuses carry across.
- **[OPEN]** what momentum represents for investigations and ordeals (progress toward resolution, pressure on the party, or standing against the subject), and what ends one. Default: no automatic end; the GM closes it and may record an outcome note.
- A **relationship** is a persistent social encounter instance between two characters. The momentum each holds with the other is the instance's momentum; it is not reset between sessions. The history lives in that instance.
- **Entering a room** with many characters: the starting momentum a character brings is the **highest** momentum they hold among relevant existing relationships, capped at the momentum ceiling. New acquaintances start at baseline and must spend actions to reach parity with someone who is vouched for. The designers called this "maybe", so make it a setting and keep the manual override.
- **After a social or mental defeat**, witnesses start later encounters with that character from a lower baseline. The GM adjudicates the size; provide a way to adjust a relationship's momentum by hand.
- An action that affects a whole room can target a **room** (a meta-encounter) as well as individual relationship instances.
- Keep the table usable: only characters with an active agenda or an existing relationship need live momentum tracks. Background characters are ambient.

---

## 8. Talents [RULE structure, content human-authored]

Talents replace branching skill trees. A **talent** has a **domain** (physical, mental, social) and a **tier** (1–3). The tree shape emerges from the prerequisite graph.

| Tier | Requirements |
|---|---|
| **1** | Open. No prerequisites. |
| **2** | At least **5 tier-1 talents in the same domain as this talent**, plus **one specific named tier-1 talent** as a prerequisite. That named prerequisite can be from **any** domain. |
| **3** | At least **5 tier-2 talents in the same domain**, plus a specific **tier-2 parent**, optionally plus a **tier-1 from any domain that is not the parent's own tier-1** (this is how trees combine). |

- Many tier-2 talents may share the same tier-1 prerequisite. No limit.
- The 5-count is per domain; 3 physical + 2 social tier-1s unlock tier 2 in neither.
- Enforce eligibility on the sheet and show *why* a talent is locked.

**Authoring principles (show them as help text in the talent editor):**

- **Bonuses live at tier 1**, if anywhere. A tier-1 effect reads "gain X when you do Y" and is gated (§2.5).
- **Higher tiers widen the circumstances, not the size.** Tier 2: "when Y or Z". Tier 3: "…even when [unusual condition]". The bonus never grows.
- **Tier 3 is more focused, not more powerful.** A tier-3 effect that works in every circumstance is a design failure; it needs a ceiling that creates real blind spots. A master of one art and a secret agent with broad tier-2 coverage are equally capable.
- A tier-1 circumstance sets the identity of everything above it.
- Talents that push a secondary up a tier situationally are a legitimate build axis (via the `tierShift` effect).
- Counter-relationships between talent groups suggest synergies: the group that thrives under conditions another group creates (for example one that burns word slots, and one that needs few words) is a natural cross-prerequisite.

Talent fields: `domain`, `tier`, `prereqTalent`, `crossPrereq` (optional, tier 3), `requires` (**[RULE, 2026-11-19]** further talents of any tier; this is how a talent's levels chain: level 2 requires level 1), `xpCost` (**[RULE, 2026-11-18]** talents are bought with XP; each talent has its own XP cost, set by the designer on the talent), `effects`, `grantsWords`, `grantsActions`, `affectsTags` (informational), `description`. **[RULE, 2026-11-21]** A talent may also require an ancestry (`requiresAncestry`); only characters of that ancestry can take it. This is how advanced ancestry features work (§3.7).

Tree names, roster and example trees discussed in design sessions are **brainstorm, not canon**. Do not ship them.

### 8.1 Conditional effects (talent "Effects" tab) [RULE structure; trigger list DRAFT]

Every talent has an **Effects tab** holding zero or more **conditional effects**. A conditional effect says: *when this event happens, grant these tier shifts for this many rounds.* This is the standard way a talent turns "a successful prior action against an uncertain situation" (§2.5) into a bonus. Talents may also carry ordinary effects (§6.3); conditional effects are the event-driven subset and get their own editor section.

**Record shape**

```jsonc
{
  "id": "cfx_01",
  "label": "Reads the opening",                     // display text for chat cards and the sheet
  "trigger": {
    "event": "actionResolved",                      // §8.1.1 catalog
    "actor": "other",                               // self | other | any | targetsMe | targetedByMe  (event-dependent)
    "tagsAll": ["strike", "offensive"],             // "at least all listed": extra tags on the action are fine
    "timing": "declare",                            // declare | resolve   (action events only)
    "outcome": "any",                               // any | hit | miss    (only valid with timing=resolve)
    "params": { }                                   // event-specific, see catalog
  },
  "conditions": [ ],                                // optional extra filters, §8.1.3
  "grant": {
    "tierShifts": [ { "stat": "physical.finesse", "delta": +1 } ],   // see targeting forms below
    "dice":       [ { "stat": "any", "buff": 0, "debuff": 0 } ],     // optional, see §8.1.4
    "applyTo": "self",                              // self | triggeringActor | target | allEncounter  (optional)
    "appliesToRolls": "all"                         // all | attack | defense   (default all)
  },
  "duration": { "rounds": 1 },                      // default 1
  "stacking": "refresh",                            // refresh | stack | ignore
  "maxStacks": 1,
  "limitPerRound": 1                                // times this effect may trigger per round (default 1)
}
```

`tierShifts[].stat` may be a stat key (`physical.finesse`), a domain wildcard (`physical.*`), an expression wildcard (`*.power`), `*` (all nine), or `rollStat` / `targetStat` (whatever the triggering action uses, when the trigger is an action event). `delta` is a signed integer; **positive is a bonus, negative is a penalty.**

#### 8.1.1 Trigger catalog

**Requested triggers**

| Event id | Fires when | Notes |
|---|---|---|
| `actionUsed` with `actor: self` | This character declares (or resolves) an action whose tags include **all** `tagsAll` | `timing` picks declare or resolve; `outcome` filters hit/miss on resolve |
| `actionUsed` with `actor: other` | Another encounter participant declares (or resolves) an action whose tags include all `tagsAll` | Same fields. `actor` may be narrowed to `targetsMe` (the action targets this character) |
| `breakPointHit` with `actor: self` | One of this character's tracks reaches a break point (§4.3) | `params.track`: any, or physical/mental/social |
| `breakPointHit` with `actor: other` | Another encounter participant reaches a break point | Same param |
| `sceneTrackChanged` with `actor: self` | This character changes encounter type (scene track §7.10) | `params.to`: action \| drama \| intrigue \| any; optional `params.from` |
| `sceneTrackChanged` with `actor: other` | Another participant changes encounter type | Same params. The initial choice at encounter start counts as a change from `none` |

Tag matching is a subset test on the action's **final assembled tag set** (§6.6), so tags added by words count. Tag values are ignored for matching unless `tagValueMin` is given (for example `slow` with `tagValueMin: 2`).

**Suggested additional triggers** (all DRAFT; each is cheap because the engine already knows the fact)

| Event id | Fires when | Why it is useful |
|---|---|---|
| `actionTargeted` | An action targets this character, evaluated at declaration, before any roll | "Braced when marked." Separates being aimed at from being hit |
| `actionHit` / `actionMissed` | Shorthand for `actionUsed` with `timing: resolve` and an outcome. `params.victim`: self \| other | Counter-style talents ("when an attack against you misses…") |
| `wordUsed` | An action containing a specific word is used. `params.words` (all listed) | Rewards or counters vocabulary identity, finer than tags |
| `statusApplied` / `statusRemoved` | A named status (or any status with a given track) is applied to or removed from a character | Combos with Exposed, grapples, Lost the Room |
| `defeatedOnTrack` / `recoveredOnTrack` | A character is defeated on a track, or recovers from it | Pairs with tier degradation (§3.3) |
| `pipsLost` | A character loses at least `params.min` pips in one resolution | "Hurt by a big hit" |
| `momentumCrossed` | A character's momentum crosses `params.value` upward or downward, or reaches ≤ 0 | Underdog and comeback talents |
| `stackPosition` | At the end of declaration, the entry sits at `params.position`: `top`, `bottom`, `directlyAbove: <tag>`, `directlyBelow: <tag>`. Subject can be self or other | Rewards Fast/Slow play and reading the stack |
| `reconfirmed` | This character was prompted to re-confirm by a Slow cascade, or changed their entry when prompted | Counters Slow play |
| `interrupted` / `interrupts` | An entry is cancelled by an interrupt, or this character cancels one | Interrupt-focused builds |
| `reactionResolved` | A reaction resolves (by or against this character) | |
| `roundStart` / `roundEnd` | Start or end of a round, optionally on round number or every N rounds | Periodic effects, "second wind" at round 3 |
| `encounterStart` / `encounterEnd` | An encounter instance opens or closes | Opening-moves talents |
| `participantJoined` / `participantLeft` | Another character enters or exits the encounter (including by surrender) | Crowd and room talents |
| `surrendered` | A participant yields at the surrender check | |
| `tierChanged` | A character's effective tier in a stat changes (degrade, shift, recovery) | Chains between talents, use with care (§8.1.5) |
| `extendedMomentum` | An extended encounter's momentum for a participant crosses a value. `params.kind`: relationship \| investigation \| ordeal \| any; optional named counterpart or subject | Relationship, investigation and ordeal talents (§7.11) |
| `cardEvent` | Deck enabled: hand cashed (optionally with a minimum hand rank), card burned, card discarded for momentum | Sharp-style archetypes (§10) |
| `restTaken` | Short or long rest completed | Between-encounter conditioning |
| `manual` | The GM or player presses a button on the sheet | Fiction-triggered effects the engine cannot see ("the crowd turns on the guard") |

#### 8.1.2 Actor scope

| `actor` value | Meaning |
|---|---|
| `self` | The talent's owner |
| `other` | Any other participant in this encounter instance (default meaning for "another character") |
| `any` | Anyone including self |
| `targetsMe` | Another participant, and the action targets the owner |
| `targetedByMe` | The subject of the event is a target of the owner's action |
| `ally` / `enemy` | **[RULE, 2026-11-18]** Participants carry an optional team label. **Ally:** same team. **Enemy:** only someone on an opposing team (both have a label, and they differ). **No label = free for all:** no allies, no enemies, and nobody's enemy. A stealthed or undeclared character sits in free for all; their target is a victim, not an opponent. Team labels are the **apparent** team, visible to everyone; there are no hidden teams. Double-crosses and reveals are mechanics that change the apparent team (effect op `team`: set a named team, clear to free for all, join the actor's team, join the target's team); changing a team label is the `teamChanged` trigger (joined a side, dropped into free for all, switched sides; now / formerly an ally or enemy of the talent's owner). |

"Nearby" in the design sense means **in the same encounter instance** (§7.1), not spatial distance. Events in a different instance (a nested brawl inside a trial) do not trigger effects in the parent unless the effect sets `params.instance: any`. **[OPEN]** whether spatial range ever matters; no distance is modeled.

#### 8.1.3 Optional conditions

A trigger may be narrowed by AND-ed conditions evaluated at the moment of the event:

- Owner's or subject's momentum above/below a value.
- Owner or subject has or lacks a named status.
- Owner or subject is at or below a pip threshold on a track.
- Round number (exact, at least, every N).
- Action roll stat or target stat equals a given stat or domain.
- Stack position relative to the owner (above or below).
- Owner has not already used a given tag-set this round (for "first time" effects).

#### 8.1.4 What an effect grants

**Primary: tier shifts.** An active effect adds `delta` to the character's tier in the matching stat(s). Tier order is tertiary (0), secondary (1), primary (2).

- All active shifts on a stat **sum**, then combine with defeat degradation (§3.3), then clamp.
- **Below tertiary:** each excess step adds **one debuff die** (same rule as degradation).
- **Above primary [OPEN]:** default clamp at primary, excess ignored. Alternative is one buff die per excess step. Expose as a setting.
- A shift applies to the owner's rolls in that stat. If `appliesToRolls` is `defense` or `all`, it also changes the **DC lookup** when the owner is the target (the defender's tier sets the DC, §2.3). Default `all`.
- With `applyTo` other than `self`, the shift lands on the named participant instead. This is how a talent can *penalize* an enemy: `delta: -1` applied to `triggeringActor`.

**Optional: dice.** The same grant may add buff or debuff dice to the affected rolls. This stays consistent with the dice-first bonus philosophy (§2.5) and the lighter-touch option designers may prefer for tier 1 effects. Not required for v1 of the editor; the schema reserves it.

**Gating check.** The editor should warn when a conditional effect has no trigger, or a trigger that is always true (for example `roundStart` with no conditions and `applyTo: self`), since that is a passive bonus and violates §2.5.

#### 8.1.5 Duration, stacking and timing

- **Duration** counts rounds, default **1**. An effect gained during round *r* with duration *n* is active from the moment it is applied through the end of round *r + n − 1*. So the default of 1 lasts the rest of the current round. An effect from an action declared early in the stack therefore applies to later resolutions the same round.
- `duration.rounds: 0` means *only the next roll*. Consume on use. Provide it; designers will want it.
- `duration.until`: `endOfRound` (default) | `startOfOwnerNextTurn` | `encounterEnd`. When set, it overrides `rounds`.
- **Stacking** when the same effect triggers again while active: `refresh` resets the duration (default), `stack` adds another instance up to `maxStacks`, `ignore` keeps the first. Effects from different talents or different sources always coexist and sum.
- **Per-round limit** (`limitPerRound`, default 1) prevents a talent from firing on every tag match in a large stack.
- **No chaining.** An effect application emits `effectApplied` for UI and logging only. It **cannot trigger other conditional effects** unless the designer sets the trigger event `tierChanged` explicitly, and even then recursion is cut off at depth 3. This avoids infinite loops and keeps results predictable at the table.
- **Evaluation order inside one event:** collect all matching effects, sort by talent id then effect id (deterministic), apply all, then recompute affected tiers once.
- **Cleanup.** Instances expire at round reset (§7.3 step 8) or encounter end, whichever applies. Persistent encounters keep only effects whose `until` is `encounterEnd` set to persist; default drops all at the end of a session's scene.

#### 8.1.6 Runtime model [IMPL]

- The rules engine emits **events** through a small bus: `{ id, type, round, instanceId, actorId, targetIds, tags, words, outcome, params }`. Every rule-relevant happening in §7 emits one (declaration, resolution, break point, scene-track change, status change, and so on). Keep the catalog in one module so new triggers are one added emitter plus one catalog row.
- On each event, a listener scans talents of every participant (owned talents only), tests `trigger` and `conditions`, and writes **active effect instances** to the combatant's flags:

```jsonc
{ "talentId": "...", "effectId": "cfx_01", "ownerId": "...", "applyToId": "...",
  "sourceEventId": "...", "round": 3, "expiresAfterRound": 3, "consumeOnUse": false,
  "tierShifts": [ ... ], "dice": [ ... ], "stacks": 1 }
```

- `effectiveTier(actor, statKey)` (§3.3) reads the sum of matching instances. The roll chat card must **list every active effect that changed the roll**, with its talent name and the event that caused it, so players can verify the math.
- Show active effects on the participant row in the Encounter Manager and on the character sheet, with remaining duration and a GM-only remove button.
- Because events can fire while a stack is being built, **recompute tiers lazily at roll time**, not at declaration. Declaration-time effects previews may use the current state, labeled as preview.
- All of this lives in `rules/` as pure functions: `matchTrigger(event, effectDef, ctx)`, `applyEffect`, `expireEffects`, `sumTierShifts`. Foundry code only forwards events and persists instances.

#### 8.1.7 Editor requirements

- The Effects tab lists conditional effects with an add button. Each effect has: label, trigger picker (event type, actor scope, tags-all chips with autocomplete from the tag registry, timing, outcome, params), conditions list, grant builder (stat picker with wildcards, signed delta stepper, optional dice), duration, stacking, per-round limit.
- A plain-language preview line is generated from the record: *"When another character resolves a hit with strike + offensive, you gain +1 tier in Physical Finesse until the end of the round."* This is the check designers use to confirm the record says what they meant.
- Validation per §8.1.4 gating check. JSON import/export covers conditional effects with the talent.

---

## 9. Armor [carried, DRAFT]

Armor has three factors:

1. What it can defend against (a set of tags or damage categories).
2. A **reduction in the attacker's momentum** for actions against the wearer. Treated here as armor contributing to the wearer's `momentum.resistance`.
3. A penalty for wearing it.

**[OPEN]** how `armor penetrating X` and `armor ineffective X` interact. Store both tags; do not implement an interaction.

---

## 10. Optional subsystem: personal card deck [DRAFT]

Gated by world setting `enableDeck` (default off). A GM can simply disable it. Foundry's core **Cards** documents map to this directly.

- Each deck user has a **personal 52-card deck**, shuffled **once** at encounter start. Draw from the top. No mid-encounter reshuffle unless a feature says so.
- Actions with the `draw` tag draw cards. Count scales with the momentum premium paid above a vanilla equivalent. **[OPEN]** formula.
- The hand builds over the encounter. **Cash-in** actions (tag `cashout`) require a minimum **poker hand** (pair through royal flush; Ace high or low; jokers wild). Resolving a cash-in **discards the whole hand**. **[OPEN]** the effect menu per hand rank.
- A hand is not kept between non-opposed scenes. In a long opposed fight the user cashes, resets and rebuilds.
- **Discard for momentum:** discard any card for its blackjack value (2–10 face; J/Q/K = 10; Ace = 1 or 11, chosen at discard). Gain that much momentum this turn; lose the same amount at the start of next turn. Poker hand evaluation is separate and uses poker values.
- **Burn:** a burned card leaves the deck for the rest of the encounter, thinning it (and making later draws more predictable).
- **Composition:** set at character creation; changes on level up. Talents can remove one suit's number cards (2–10), remove one suit's face cards, or add up to two wild jokers.
- **Blind mode:** the GM and enemies can see the user's hand; the user and their allies cannot. Cash-in bonuses are doubled (**[OPEN]** meaning of "bonus"); attempting a cash-in without a valid hand discards the whole hand.
- **[OPEN]** which actions draw; hand persistence across persistent encounters.

**Decisions from 2026-11-17 (designer, supersede the lines above where they conflict):**

- The deck is per character, built at encounter start only for characters with an ability that interacts with cards.
- Abilities can add cards to or strip cards from the deck. Composition effects are collected before the deck is built.
- When the draw pile runs dry mid-draw, cards already used in hands are reshuffled into a new deck. This replaces "no mid-encounter reshuffle".
- Players pick cards out of their hand to form a poker hand (at most five). Hand quality is an integer from 0 (high card) to 10 (five of a kind). Abilities can require a minimum quality, consume a hand of a set quality, or grant more (for example extra dice) for better hands.
- Cards discarded for momentum go to the used pile and can be reshuffled.
- **Marked cards**: a mark is a special effect on a card that fires when the card is used in a hand. Marks: burn the whole hand instead of returning it to the used pile (deck thinning); draw N cards (0 = as many as the hand contained); the hand counts one rank higher. A mark can be consumable (used up for the encounter once it fires). Each mark type applies once per hand: the copy on the card the player added to the hand first is the one used (its value applies, and it is used up if consumable); other copies are untouched.
- Implementation details and the effect format: `docs/CARD_DECK.md`.

Intended economy: low starting momentum and high momentum gain per round. Pre-cash-out actions cost more momentum than vanilla equivalents. This is a "finisher" archetype that needs a long fight and cover in the early rounds.

---

# PART 2 — IMPLEMENTATION GUIDANCE [IMPL]

## 11. Platform and layout

**Foundry game system**, id `modulus`. Use ES modules, `ApplicationV2`, `TypeDataModel` for actor/item data, and `Roll` for dice so dice-animation modules work. Do not use jQuery-era legacy sheets. Verify all names against the current API.

```
modulus/
  system.json
  module/
    rules/        # PURE JS. No Foundry imports. Unit-tested.
      dice.js allocation.js tracks.js momentum.js assembly.js
      stack.js cascade.js talents.js deck.js
    data/         # TypeDataModel classes
    documents/    # ModulusActor, ModulusItem, ModulusCombat, ModulusRoll
    apps/         # sheets, EncounterManager, DeclareDialog, VocabEditor, TalentEditor
    socket/       # GM <-> player request/response
  templates/  styles/  lang/en.json  packs/  tests/
```

`system.json`: `documentTypes` Actor `character`, `npc`; Item `action`, `word`, `talent`, `skill`, `status`, `ancestry`, `society`, `background`, `armor`. Compendium packs: `actions`, `words`, `talents`, `statuses` (ship empty plus fixtures). Enable the socket.

## 12. Data models

**Actor `character`**

| Path | Notes |
|---|---|
| `level`, `xp.total`, `xp.spent` | |
| `allocation` | `{ domain, expression, freeDot }` source of the dots |
| `stats[domain][expression]` | derived `dots`, derived `tier`, placeholder `bonus` (default 0) |
| `tracks[domain]` | `pipsLost` (or a per-segment array), derived `max`, derived `tier` (from that domain's resilience) |
| `momentum` | `starting`, `gainPerTurn`, `current`, derived `ceiling`, `resistance{physical,mental,social}` |
| `sceneTrack` | per encounter, stored on the combatant |
| `respecPoints` | |
| `deck` | optional |

**Actor `npc`**: same fields, plus `statsMode: "dots" | "direct"` so GMs can set tiers directly, and optional direct pip overrides.

**Items**: `action`, `word`, `talent`, `skill`, `status`, `ancestry`, `society`, `background`, `armor` with the fields in §3, §6, §8, §9. Statuses are embedded Items on the actor (simple and visible); the engine reads their effects. Do not rely on Active Effects for dice or tier logic.

**Encounter instance**: a `Combat` document (subclass `ModulusCombat`) with module data in flags: `stack`, `round`, per-combatant `momentum`, `sceneTrack`, `submissionState`, `scale`, `parentId`, `persistent`, `kind` (`standard` | `relationship` | `investigation` | `ordeal`), and for extended kinds the counterpart or subject. **Do not rely on `game.combat`.** Several instances run at once; address them by id and give the GM an Encounter Manager window that lists them. Keep the sidebar tracker working but secondary.

## 13. Roll engine

Put this in `rules/dice.js` with an injectable RNG for tests.

```js
export function rollKept({ tier, buff = 0, debuff = 0, rng }) {
  const n = 3 + buff + debuff;
  const faces = Array.from({ length: n }, () => 1 + Math.floor(rng() * 20));
  const sorted = [...faces].sort((a, b) => a - b);
  const kept3 = sorted.slice(buff, n - debuff);            // exactly 3
  const idx = { tertiary: 0, secondary: 1, primary: 2 }[tier];
  return { faces, sorted, kept3, kept: kept3[idx] };
}
```

In Foundry: build `new Roll(`${n}d20`)`, evaluate it so dice animations still play, then pass the faces through the pure function. Foundry's built-in keep/drop modifiers cannot express "keep the middle die" cleanly, so do not rely on them. Mark discarded dice in the term results (`discarded`, `active`) so they render struck-through.

**Chat card** shows: actor, action and words, rolling stat and tier (with any degradation or tier shift), every die with dropped dice dimmed and the kept die highlighted, flat bonuses, total, DC with its source (target, stat, tier), and **Hit/Miss**. Add GM buttons for on-hit and on-miss effects.

**Roll dialog** (for manual rolls): stat picker, buff/debuff dice counters, optional flat gated bonus, DC mode (target actor + stat, or manual number).

## 14. Encounter engine and UI

**Authority.** The GM client owns the state machine; players only send requests. Request/response between GM and players should use Foundry's user-to-user query facility or a system socket. Every transition must be GM-overridable (skip a missing player, declare on their behalf, force-confirm).

**Phases:** `idle → participation → declaring (with reconfirm sub-state) → finalization → executing → surrender → round-end`. Keep each transition a pure function in `rules/stack.js` and `rules/cascade.js` so it is testable without Foundry.

**GM Encounter Manager** (one window):

- Instance list and create/open (short, persistent, nested).
- Round controls.
- Participant table: character, momentum, scene track, state, tags.
- The stack, drawn top-to-bottom as it will resolve, with state badges (Pending, Submitted, Locked, Charging), tag chips, target, effective momentum, and cost.
- Resolution panel: Roll, then outcome buttons.
- Surrender-check list.

**Player view:**

- Participation prompt (checkbox per owned character, momentum shown).
- **Declare dialog**: core action, words (limit `maxWords`, with a live cost preview and warning if unaffordable), target, scene-track bonus preview. Unaffordable declarations are blocked.
- **Reconfirm prompt** (pre-filled, editable, with a note saying who caused it).
- **Duelist drop prompt.**
- A read-only live stack.

**Momentum on the sheet:** a player must be able to see and edit their momentum for any encounter they are in. Persistent instances keep per-participant momentum between sessions. Mechanism is your call.

## 15. Sheets and authoring UI

- **Character sheet**: dot allocator (click to place, shows resulting shape and validates), derived tier badges, three pip tracks with break points flagged, momentum block, statuses, known actions/words (trained ones appear only when granted), talents with eligibility and "why locked", XP and level.
- **Vocabulary editor**: list, filter and edit actions, words, tags, statuses; effects editor (typed rows); **import and export JSON** for the whole vocabulary or a selection, including the optional `groups` labels. This is where designers will spend most of their time.
- **Talent editor**: domain, tier, prerequisites chosen from a graph picker, and a read-only view of the resulting prerequisite graph with a validity check.
- **Hand tools**: GM buttons for short rest, long rest, clear a defeat status, adjust a relationship's momentum, apply 1 pip.

## 16. Settings

Register each as a world setting with a short description. Anything marked OPEN must appear here so designers can change it without code changes.

| Setting | Default | Status |
|---|---|---|
| `dc.primary / .secondary / .tertiary` | 14 / 11 / 8 | OPEN (13/11/9 candidate) |
| `defaultTaskDC` | 11 | OPEN |
| `momentum.ceiling` | `5 + level` | carried |
| `momentum.startingDefault` | 3 | carried |
| `momentum.gainDefault` | 1 | placeholder |
| `momentum.floor` | none | OPEN |
| `costSpendTiming` | resolve (validate at declare) | OPEN |
| `costFloorZero` | true | OPEN |
| `resistanceTrack` | domain of target stat | OPEN |
| `maxWordsFormula` | `2 + floor(level/4)` | OPEN |
| `extraWordPenalty` | one debuff die per word past 2 | OPEN placeholder |
| `focusBonus` | off | OPEN |
| `sceneTrackBonusDice` | 1 buff die | DRAFT |
| `exposedMode` | flat | OPEN |
| `defeatAffectsDefense` | true | OPEN |
| `diceStacking` | additive, no cap | DRAFT |
| `sameNameTagStacking` | sum | OPEN |
| `statOverrideConflict` | last word wins | OPEN |
| `cascadeDepthCap` | none (guard 25) | OPEN |
| `chargeResolvesOn` | Xth consecutive declaration | OPEN |
| `interruptMode` | manual GM | OPEN |
| `autoApplyOutcomes` | false | |
| `pips.perLevel` | 4 / 3 / 2 | DRAFT |
| `pips.minLevel` | 1 | OPEN |
| `condFx.defaultDuration` | 1 round | DRAFT |
| `condFx.aboveRank` | clamp at primary (alternative: buff die per excess step) | OPEN |
| `condFx.defaultLimitPerRound` | 1 | DRAFT |
| `condFx.chainDepth` | 0 (3 when `tierChanged` is the trigger) | DRAFT |
| `condFx.shiftsAffectDefense` | true | OPEN |
| `enableDeck` | false | optional |
| `roomEntryMomentum` | highest relationship, capped | DRAFT |

## 17. Testing

### 17.1 Principles

All of `module/rules/**` is plain JS under a test runner. Use an injectable RNG; for distribution tests, enumerate rather than sample.

### 17.2 Required test cases

1. **Dice distribution.** Exhaustively enumerate `rollKept` for each tier and each of the operations in Appendix B. Means and P(kept = 20) must match Appendix B exactly.
2. **Allocation.** Physical Power with free dot on Social Power → 2 primary, 3 secondary, 4 tertiary. Free dot on the intersection rejected. Free dot on a tertiary → 1/5/3.
3. **Pips.** Level 2, tertiary-resilience track → 4 pips; primary → 8; secondary → 6.
4. **Cost.** Action cost 1, words +1 and −1, offensive, target resistance 2 → total 3. The same without `offensive`, or targeting self → 1.
5. **Order and rolloff.** Participants at 4, 6, 7, 8, 8, 9. The two 8s roll 11 and 11, then 15 and 9: the 9 declares first. The winner (15) declares later and resolves earlier.
6. **Slow cascade.** Participants at 4 (A), 6 (B), 7 (C), 8 (E, lost rolloff, already declared), 8 (D, won rolloff), 9 (F, not yet declared). D declares Slow 3 → insertion at 5. Prompted: B, C, E. Not prompted: A (effective 4), F (pending), D itself.
7. **Locked auto-confirm.** C declared Slow 2 (effective 5, Locked). D then declares Slow 4 (effective 4). C is above the insertion point but is auto-confirmed with no prompt.
8. **Cascade chain.** A prompted player switches to a Slow action; a new cascade runs from its insertion point; Locked entries skipped; guard stops runaway loops.
9. **Fast.** Momentum 5 declares Fast 3 → effective 8, no prompts, resolves above entries at 6 and 7.
10. **Duelist.** Duelist 3, momentum 10, lowers 2 → effective 8, +2 flat to the roll. Two Duelists act in descending effective order.
11. **Degradation.** Secondary stat, one defeated track → rolls as tertiary. Tertiary stat, two defeated tracks → tertiary plus 1 debuff die.
12. **Talents.** Tier 2 locked at 4 same-domain tier-1s, unlocked at 5 plus the named prerequisite (from another domain is allowed). Tier 3 locked with 4 tier-2s.
13. **Negative momentum.** At ≤ 0 only `recovery` actions can be declared.
14. **Charge, Taxing, Determined, Inevitable** bookkeeping across rounds.
15. **Conditional effect, self action.** Talent: `actionUsed`, actor self, tagsAll `[strike]`, resolve, hit, +1 tier physical.finesse, 1 round. A secondary-finesse owner hits with a strike in round 2 → rolls later that round at primary finesse; in round 3 back to secondary. A strike that also carries extra tags still matches; a hit lacking `strike` does not.
16. **Conditional effect, other actor.** Talent triggered by another participant's action with tags `[control, offensive]` at declare. An action tagged only `control` does not match. The owner's own action never matches `actor: other`.
17. **Break point and scene track.** `breakPointHit` self/other fires once per break point reached, not per pip afterward. `sceneTrackChanged` fires for the encounter-start choice (from `none`) and for later changes; a change to the same track does nothing.
18. **Duration and stacking.** Default duration lasts to end of round; duration 0 is consumed by the next roll; `refresh` does not double the shift, `stack` with `maxStacks: 2` does; a talent with `limitPerRound: 1` fires once with three matching actions in one round.
19. **Clamping.** +2 shift on a tertiary stat → primary; −1 on a tertiary → tertiary plus one debuff die; +1 on a primary → primary (default setting). Defeat degradation and shifts sum before clamping.
20. **No chaining.** An effect applied by a trigger does not trigger another effect unless the trigger is `tierChanged`; recursion stops at depth 3.

### 17.3 Test fixtures (not canon; do not ship as content)

| Item | Definition |
|---|---|
| Action **Strike** | rollStat physical.power, targetStat physical.finesse, tags `strike`, `offensive`, cost 1 |
| Action **Grapple** | physical.power vs physical.power, tags `control`, `offensive`, cost 1 |
| Action **Recuperate** | tag `recovery`, cost 0, sets momentum to 3 |
| Word **Charging** | modifier +1, tag `movement` |
| Word **Steady** | modifier −1, tag `slow 2` |
| Word **Darting** | modifier +1, tag `fast 1` |
| Word **Wrenching** | overrides targetStat to physical.resilience; on hit, restrict tag `two-handed` until the target wins a Power-vs-Power break contest |

## 18. Phases

| Phase | Scope | Done when |
|---|---|---|
| **1. Foundation** | System skeleton, data models, character sheet with dot allocator, pips, momentum fields, settings, roll engine, roll dialog, chat card | Tests 1–3 pass; a character can be built and a roll posted with correct dropped/kept dice |
| **2. Vocabulary** | Action/word/tag/status items, effects editor, assembly engine, cost preview, JSON import/export | Test 4 passes; export → import round-trips; fixtures work |
| **3. Encounter stack** | `ModulusCombat`, Encounter Manager, participation, rolloff, declaration, Slow/Fast cascade, Duelist, execution with roll buttons, surrender check, round reset, Charge/Taxing/Determined/Inevitable | Tests 5–11, 13–14 pass; a full multi-client round plays end to end |
| **4. Talents and progression** | Talent items and graph, eligibility, XP and levels, skills, creation flow, defeat degradation | Test 12 passes; locked talents explain themselves |
| **5. Persistent encounters** | Extended instances (relationship, investigation, ordeal), room entry, nested instances, scene-track choice and bonus, break-point prompts | A relationship resumes with its momentum after a session reload |
| **6. Optional** | Card deck on Cards documents, armor, ability builder (Appendix C) | Behind `enableDeck` and feature flags |

---

# APPENDICES

## Appendix A — Reconciliation with older sources

| Older source | Status | Resolution |
|---|---|---|
| 3d20 keep lowest/mid/highest by tier | Kept | §2.1 |
| 13-point buy; primary 3, secondary 1; "2 point retraining" | **Superseded** | Dot allocation (§3.2); respec is OPEN (§3.4) |
| "+15 to −15 difficulty, static target numbers" | **Superseded** for opposed actions | Fixed defense by tier (§2.3). Task DC OPEN |
| Defense targets 5 / 10 / 15 | **Superseded** | 14/11/8 or 13/11/9 (OPEN) |
| "Modifiers based on skills, enhancements, situational modifiers" | **Superseded** | Dice-only philosophy (§2.5) |
| Critical successes and failures (intro text) | **Removed** | No crits (§2.1) |
| HP = 10 + level + ⅓ skill points | **Superseded** | Pips by tier (§4.2) |
| Depletion penalty: drop one tier, tertiary adds a die | Kept | §3.3, §4.5 |
| Overflow damage; KO conditions | Kept | §4.4 |
| Momentum ceiling 5 + level; base 3; resets at scene end | Kept | §5 |
| "Momentum scales from zero to ten" (intro text) | Outdated | Use the ceiling formula |
| Negative momentum forces a Recovery action | Kept | §5.2 |
| Stack initiative: count up, interject at or above count | **Reworked** | Declare ascending, resolve descending (§7.3) |
| Tie: d20, highest goes first | Kept | §7.3 |
| Tags: Slow, Fast, Reaction, Interruptible, Charge, Recovery, Inevitable, Taxing, Determined, Magic | Kept | §6.4 |
| **Duelist X** as repositioning | **Superseded** | Drop effective momentum 0–X for an equal flat bonus (§7.5) |
| Armor penetrating / ineffective X | Kept as data | Behavior OPEN |
| Armor's three factors | Kept | §9 |
| Draining X | Pending in source | Not implemented |
| Ability construction system | Carried | Appendix C, Phase 6; reconcile with actions and words |
| Rank 6 and 11 specialization branching | **Superseded** | Talent tiers (§8) |
| Skills cost 10 × rank; XP table; creation aspects | Kept | §3.5–§3.7 |
| Setting content (Stormlocked Allivasia, Spherewielder, Weavemage, Praetor and so on) | Content | Out of scope |
| Discord: Maneuver / Tactic / Gambit slot types | **Superseded** | Words and tags |
| Discord: "Synergy" and "combo" action chaining | **Superseded** | Word chain |
| Discord: universal Gambit poker-hand system | **Reworked** | Optional personal deck (§10) |
| Discord: "SNAKE system" | Never defined | Ignore |
| Discord: pip-based HP, 4/3/2 per level | Kept (DRAFT) | §4 |
| Discord: Exposed X | Kept as status | §6.5 |
| Discord: Delayed, Interruptible 1–3 | Kept (DRAFT/OPEN) | §6.4 |
| Discord: Interrupt / Aid / Hinder as a separate reaction phase | **Rejected** | §7.6 |
| Discord: unused word slots held in reserve | **Rejected** | §6.7 |
| Discord: core word system, packs, skills grant words | Kept (DRAFT) | §3.6, §6.7 |
| Earlier Python/tkinter stack-tool design | **Dropped** | Replaced by this document |

## Appendix B — Exact probability tables

Computed by exhaustive enumeration of all outcomes (20³ to 20⁵ combinations). Use these; several earlier figures in the Discord and in earlier drafts were estimated and are wrong.

**Expected kept value**

| Operation | Tertiary | Secondary | Primary |
|---|---|---|---|
| Base 3d20 | 5.51 | 10.50 | 15.49 |
| One buff die (4d20, drop lowest) | 8.50 | 12.50 | 16.48 |
| One debuff die (4d20, drop highest) | 4.52 | 8.50 | 12.50 |
| Compression (5d20, drop high and low) | 7.17 | 10.50 | 13.83 |
| Two buff dice (5d20, drop 2 lowest) | 10.50 | 13.83 | 17.15 |
| Two debuff dice (5d20, drop 2 highest) | 3.85 | 7.17 | 10.50 |

**Probability the kept die is a natural 20**

| Operation | Tertiary | Secondary | Primary |
|---|---|---|---|
| Base 3d20 | 0.0125% | 0.7250% | 14.2625% |
| One buff die | 0.0481% | 1.4019% | 18.5494% |
| One debuff die | 0.0006% | 0.0481% | 1.4019% |
| Compression | 0.0030% | 0.1158% | 2.2593% |
| Two buff dice | 0.1158% | 2.2593% | 22.6219% |
| Two debuff dice | 0.0000% | 0.0030% | 0.1158% |

Natural-20 frequency at base: primary about 1 in 7, secondary about 1 in 138, tertiary 1 in 8000.

**Hit rate (kept ≥ DC), base 3d20**

Preset A, DC 14 / 11 / 8 (primary / secondary / tertiary defender):

| Attacker | vs Tertiary (8) | vs Secondary (11) | vs Primary (14) |
|---|---|---|---|
| Primary | 95.7% | 87.5% | 72.5% |
| Secondary | 71.8% | 50.0% | 28.2% |
| Tertiary | 27.5% | 12.5% | 4.3% |

Preset B, DC 13 / 11 / 9:

| Attacker | vs Tertiary (9) | vs Secondary (11) | vs Primary (13) |
|---|---|---|---|
| Primary | 93.6% | 87.5% | 78.4% |
| Secondary | 64.8% | 50.0% | 35.2% |
| Tertiary | 21.6% | 12.5% | 6.4% |

Original doc, DC 15 / 10 / 5, for reference:

| Attacker | vs Tertiary (5) | vs Secondary (10) | vs Primary (15) |
|---|---|---|---|
| Primary | 99.2% | 90.9% | 65.7% |
| Secondary | 89.6% | 57.5% | 21.6% |
| Tertiary | 51.2% | 16.6% | 2.7% |

**Hit rate against DC 11 with dice effects**

| Operation | Tertiary | Secondary | Primary |
|---|---|---|---|
| Base | 12.5% | 50.0% | 87.5% |
| One buff die | 31.2% | 68.8% | 93.8% |
| One debuff die | 6.2% | 31.2% | 68.8% |
| Compression | 18.8% | 50.0% | 81.2% |

**Corrections to figures circulated earlier** (do not reuse the old ones): base means were quoted as 4.7 / 10.5 / 15.3 (true 5.51 / 10.50 / 15.49); a primary under a debuff die was said to have a nat-20 chance under 1% (true 1.40%); a tertiary under a debuff die was said to be unchanged (it shifts down by about 1.0); several cells of the 14/11/8 hit table were slightly off (use the table above).

## Appendix C — Original ability-construction data (Phase 6, reconcile first)

Carried from the original doc for a later "ability builder". It predates the action/word model. Decide with the designers how it relates before building it. Damage here (Light/Medium/Heavy) conflicts with the pip model.

- A feature grants a maximum ability cost and a number of ability points based on feature cost; base cost is always 1 momentum. Momentum gain is capped at 50% of granted points (cap 150%).
- Build formula: `Sum(BaseCost[]) + countOfCostAboveZero² `. One feature point per 3 purchases in an attribute. Max features tied into one ability = level. 4 points per feature tied.

| Component | Options (cost) |
|---|---|
| Additional momentum | 1–5 |
| HP cost | 1–3 |
| Maximum HP cost | 1–5 |
| Skill penalty | 1–3 |
| Actions before casting | 1 or 2 |
| Actions after casting | 1 or 2 |
| Vulnerability/drawback | 1–10 (Slow X, Interruptible, Armor ineffective X are examples) |
| Components | 1 or 2 (setting-specific) |
| Limited use | 1–5 |
| Cooldown | 1 or 2 |
| Range | self/touch 0, close 10 m 1, medium 60 m 3, long 250 m 5, extreme 1000 m 8, ridiculous 5000 m 13, global 21 |
| Targeting | line of effect 0, line of sight 1, awareness 3, intent 7 |
| Damage | light 1, medium 3, heavy 6 |
| Healing | light 3, medium 5, heavy 8 |
| Effect | momentum change 2–10 (others only), boon 1–3, bane 1–3, environment change 2–5, equipment creation 1–3, system change 2–10 |
| Duration | fleeting (1 action) 0, round, minute, hour/scene, persistent |

## Appendix D — Open questions (seed `OPEN_QUESTIONS.md` with these)

| # | Question | Default used meanwhile |
|---|---|---|
| 1 | DC preset: 14/11/8 or 13/11/9 | 14/11/8 |
| 2 | DC for unopposed tasks | GM-entered; suggest 11 |
| 3 | ~~How are talents acquired? How do skills, talents and word packs relate?~~ **Decided:** each talent has its own XP cost (2026-11-18); skills and levels are removed, XP is spent only on talents (2026-11-19) | |
| 4 | ~~How do characters acquire words?~~ **Decided 2026-11-19:** from talents (`grantsWords`), plus base words everyone knows | |
| 5 | `maxWords` formula and the extra-word penalty | `2 + floor(level/4)`; one debuff die per extra word |
| 6 | Focus bonus magnitude | Off |
| 7 | Buff/debuff stacking and caps | Additive, no cap |
| 8 | Same-name tag stacking; overlapping stat overrides | Sum; last word wins |
| 9 | Momentum floor | None |
| 10 | When cost is spent; cancelled entries; cost floor | At resolution; nothing spent if cancelled; floor 0 |
| 11 | Which resistance track applies | Domain of target stat |
| 12 | Interrupt mechanic and meaning of `interruptible X` | GM-adjudicated button |
| 13 | Aid/Hinder specifics | X buff / debuff dice on a lower entry |
| 14 | Reaction timing, targeting, no-roll rule | Declared in place of own action |
| 15 | `delayed` | Resolves after all non-delayed entries |
| 16 | Charge resolution timing | On the Xth consecutive declaration |
| 17 | Inevitable specifics (ordering only vs also costs) | Ordering |
| 18 | Armor penetrating/ineffective semantics; armor ↔ resistance | Data only |
| 19 | Exposed X: flat or dice | Flat |
| 20 | Defeat: compounding, effect on defense, break-point effects, recovery | Per track, applies to defense, no break-point penalty, clears when pips return or GM clears |
| 21 | Damage scaling beyond 1 pip | Manual |
| 22 | Pips at level 0; exact break-point structure | Treat level as ≥ 1; segment per level |
| 23 | Respec and tier-shift rules; floating points | `respecPoints` counter, manual |
| 24 | Scene-track bonus size and the Action/Drama/Intrigue names | 1 buff die; names provisional |
| 25 | Room-entry momentum, witness effects, nested-instance linkage | Highest relationship, capped; GM adjusts |
| 26 | Deck: draw formula, draw triggers, cash-in menu, blind-mode "double", hand persistence | Deck off |
| 27 | Opposed/contested rolls | Not built; manual GM roll |
| 28 | `draining X` | Not built |
| 29 | Cascade depth cap | None, guard 25 |
| 30 | Ability builder vs action/word model | Phase 6 only |
| 31 | Second example setting (listed as "???" in source) | Out of scope |
| 32 | Conditional effects: do shifts above primary give a buff die or clamp | Clamp |
| 33 | Conditional effects: do tier shifts change the owner's defense DC | Yes (`appliesToRolls: all`) |
| 34 | Conditional effects: is "nearby" encounter-scoped only, or does distance or range ever matter | Encounter-scoped |
| 35 | ~~Teams: is there an ally/enemy distinction for triggers~~ **Decided 2026-11-18:** team labels; same = ally, opposing = enemy; no label = free for all with no allies or enemies; team changes are a trigger (§8.1.2) | |
| 36 | Conditional effects: when a duration-1 effect is gained mid-round, does it apply to remaining resolutions this round or start next round | Applies to the rest of this round |
| 37 | Conditional effects: should effects be allowed to grant dice and not only tier shifts at launch | Schema allows it; editor can hide it |
| 39 | Extended encounters: what momentum means for investigations and ordeals, and what ends them | Not defined; GM closes manually |
| 40 | Extended encounters: does a subject (mystery, wilderness) have HP tracks | Momentum only |
| 41 | Extended encounters: do investigations and ordeals use the room-entry and witness rules (§7.11) or only relationships | Relationships only |
| 38 | Conditional effects: final trigger list (which of the suggested triggers in §8.1.1 are in v1) | All implemented behind a registry; designers can disable triggers in settings |
