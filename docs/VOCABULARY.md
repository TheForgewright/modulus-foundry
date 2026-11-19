# Vocabulary authoring guide

How designers author actions, words, statuses, talents and tags (§6 of `DESIGN.md`).

## Where

- **Vocabulary Editor**: the *Vocabulary Editor* button at the top of the Items sidebar (GM), or *Game Settings → Configure Settings → Modulus → Vocabulary Editor*. It lists world actions, words, statuses and talents with search, type and group filters, create / duplicate / delete, a **Tags** tab, and JSON import / export.
- Clicking a name opens the item sheet, which has the tag chips and the typed **Effects** editor.

## Effects

Every action, word, status and talent has an Effects list. Each row is *when* (trigger), *what* (op) and *who* (self, target, room), plus the op's arguments. Under each row is a plain-language line, e.g. *"On hit: the target cannot use two-handed actions until they break free (break: Strength vs Strength)."* Use it to check the row says what you meant. Rows with problems are outlined in red with the reason.

| Trigger | Meaning |
|---|---|
| When declared / When finalized | Applies while the action is being put together: stat overrides, cost, dice, tags, fixed DC. |
| On hit / On miss / On resolution | Offered to the GM when the action resolves (or applied at once with the *Auto-apply outcomes* setting). These can be **delayed**: the hourglass box on the row sets a number of rounds. |
| While active | Passive while a status is on the character (status effects only). |

| Op | Arguments | Notes |
|---|---|---|
| Change cost | amount | Adds to the momentum cost. |
| Momentum | amount, or *set to* | Grant or remove momentum, or set it (Recuperate sets 3). |
| Draw cards | cards | Card deck (§10). |
| Override rolling / target stat | stat | When several words override the same stat, the last declared wins (setting). |
| Buff / debuff dice | buff, debuff | The preferred bonus language (§2.5). |
| Tier shift | amount, stat (optional; default the rolling stat), applies to | Positive raises the tier, negative lowers it. |
| Fixed DC | value, or *use default task DC* | For unopposed actions. |
| Flat bonus (gated) | value | Only for bonuses earned by a prior action or a momentum spend (§2.5). |
| Add tag | name, value | Adds to the action's tags. |
| Movement | text | Free text. |
| Apply / remove status | mode, name, value | |
| Pips | amount, track | Positive is damage, negative heals. |
| Restrict tag | tag, until, break roll / break vs | e.g. a joint lock forbids `two-handed` until a Power-vs-Power break. |
| Change team | mode, name | The participant's apparent team in this encounter: set to a named team, drop into free for all, join the acting character's team (recruit, convert), or join the target's team (defect, infiltrate). The change is the *Team changed* talent trigger. |
| Note for the GM | text | Anything the engine cannot adjudicate. |
| Card ops | JSON | See `CARD_DECK.md`. |

## Delayed effects

An on-hit, on-miss or on-resolution effect with a delay (the hourglass box on its row, in rounds) is not applied when it is applied: it is **scheduled**. At the start of the round it falls due it takes effect, posted to chat with its Apply button (or applied straight away with *Auto-apply outcomes*). A delay of 1 means the start of next round. The preview reads "On hit, 2 rounds later: the target loses 1 pip of physical."

The Encounter Manager lists pending delayed effects with the round they fall due; the GM can cancel one (dispelled, interrupted). Delays only exist inside an encounter: outside one, a delayed effect applies immediately. Pending delayed effects end with their encounter.

## Tags

Type a tag in the box under the chips and press **Add**; `slow 2` adds `slow` with value 2. Autocomplete offers every registered tag. Engine tags (blue chips) drive rules (§6.4); the rest are labels that talents and conditions can target. The **Tags** tab in the editor lists engine tags, the common labels and your own, with how many items use each, and flags tags in use that are not registered.

## Who can use what

- An **action** with *Trained* off is available to every character once it exists in the world. Trained actions must be on the character.
- **Any word can be used by anyone.** The word declares what the character is trying to do. A character who doesn't **know** the word pays its costs on that roll: a *Roll penalty when not known* (flat, entered as 2 or −2), a *Tier downgrade when not known* (tiers off the rolling stat; below tertiary each step is a debuff die), or both. Knowing it negates them. A character knows a word if it is a *Base word* (everyone), if it is on their sheet, or if one of their talents grants it (*Grants words*: names or vocabulary ids, comma-separated). The Act and Declare windows list every word and mark unknown ones with their costs ("Acrobatic (+1) · not known: −2, −1 tier"); the roll shows each as its own line.
- A **trained action** comes from a talent's *Grants actions* list the same way, or from being on the character.
- **Compendium content is used directly.** The system's compendium actions, words, statuses and talents are available in every world without importing them: the Act and Declare windows, the Talents tab and status effects read them straight from the compendiums, and a new version's changes apply as soon as it is deployed. World Items work alongside them; a world copy of a compendium entry (imported or dragged in) overrides that entry in that world.

## Trying it: the Act window

The **Act** button on a character sheet opens the Action Builder: pick an action and up to *max words* words (a red slot means over the limit), choose the target (target a token first), and see live:

- the merged tags, the cost line by line (including the target's resistance for `offensive` actions) and momentum after paying;
- effective momentum after Slow / Fast;
- the kept tier, every buff and debuff die with its source, the DC with its source, and the chance to hit;
- what happens on hit, on miss and on resolution;
- why the declaration is not allowed (too many words, unaffordable, only Recovery at 0 momentum).

**Resolve** rolls it, posts the card with the matching outcome lines and, if *Spend momentum* is ticked, pays the cost. The Phase 3 declare dialog will reuse this.

## Import and export

Export writes one JSON file (`modulus-vocabulary-<date>.json`) for the selection, the current filter, or everything, plus your custom tags. Each item carries a `vocabId`; importing a file updates items with the same `vocabId` and creates the rest, so a file can go back and forth between worlds and designers without duplicating anything. Folder names are kept. Bad files are rejected with a list of reasons before anything changes.

## Test fixtures

The *Test Fixtures (not canon)* compendium holds the §17.3 items (Strike, Grapple, Recuperate, Charging, Steady, Darting, Wrenching). Import them into the world to try the Act window. They are for testing only.

## Building packs

Compendium contents live as JSON under `packs/_source/<pack>/`. After editing them:

```bash
npm install
npm run build:packs
```
