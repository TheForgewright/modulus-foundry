/**
 * Render check: runs the system's real data preparation and window context code against stand-in
 * documents, renders every sheet, window and chat card with real Handlebars, and fails on template
 * errors or on "undefined", "[object Object]", "NaN" or raw translation keys in the output.
 * Scenarios cover each sheet tab, every item type, the Act / Declare / Re-confirm windows, the
 * Encounter Manager in every phase, the Vocabulary Editor, the talent graph and the chat cards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installSim, registry, makeItem, makeActor, makeSystem, Collection, renderFile, ROOT } from "./render-sim.mjs";

installSim();
await import("../module/modulus.js");
Hooks.callAll("init");

const { ModulusActor } = await import("../module/documents/actor.js");
const { ModulusItem } = await import("../module/documents/item.js");
const { ModulusCombat, ModulusCombatant } = await import("../module/documents/combat.js");
const { ModulusRoll } = await import("../module/documents/roll.js");
const { CharacterData, NPCData } = await import("../module/data/actor.js");
const { ITEM_MODELS } = await import("../module/data/item.js");
const { ModulusActorSheet } = await import("../module/apps/actor-sheet.js");
const { ModulusItemSheet } = await import("../module/apps/item-sheet.js");
const { VocabularyEditor } = await import("../module/apps/vocab-editor.js");
const { ActionBuilder } = await import("../module/apps/action-builder.js");
const { EncounterManager } = await import("../module/apps/encounter-manager.js");
const { TalentGraph } = await import("../module/apps/talent-graph.js");
const { CharacterCreation } = await import("../module/apps/character-creation.js");
const E = await import("../module/rules/encounter.js");
const { newCondFxState, processEvent } = await import("../module/rules/condfx.js");
const { scheduleDelayed } = await import("../module/rules/delayed.js");

const failures = [];
let rendered = 0;
const setSetting = (key, value) => { registry.settings.get(key).value = value; };

/* ---------------- Checks ---------------- */

function check(label, html) {
  rendered++;
  const text = String(html);
  const problems = [];
  if (/\bundefined\b/.test(text)) problems.push("undefined");
  if (/\[object Object\]/.test(text)) problems.push("[object Object]");
  if (/\bNaN\b/.test(text)) problems.push("NaN");
  // Raw keys, except in data-tooltip attributes (Foundry localizes those on hover).
  const visible = text.replace(/data-tooltip="[^"]*"/g, "");
  const raw = [...visible.matchAll(/\b(?:MODULUS|TYPES)\.[A-Za-z][\w.]*/g)].map((m) => m[0]);
  if (raw.length) problems.push(`untranslated: ${[...new Set(raw)].slice(0, 6).join(", ")}`);
  for (const p of problems) {
    const at = text.search(p === "undefined" ? /\bundefined\b/ : p === "NaN" ? /\bNaN\b/ : p.startsWith("untranslated") ? /\b(?:MODULUS|TYPES)\./ : /\[object Object\]/);
    failures.push(`${label}: ${p}${at >= 0 ? `\n      …${text.slice(Math.max(0, at - 120), at + 60).replace(/\s+/g, " ")}…` : ""}`);
  }
}

async function renderApp(label, app, partNames = null) {
  try {
    const context = await app._prepareContext({});
    const parts = app.constructor.PARTS;
    for (const [name, part] of Object.entries(parts)) {
      if (partNames && !partNames.includes(name)) continue;
      check(`${label} [${name}]`, renderFile(part.template, context));
    }
  } catch (err) {
    failures.push(`${label}: ${err.stack?.split("\n").slice(0, 4).join("\n      ") ?? err}`);
  }
}

async function attempt(label, fn) {
  try {
    check(label, await fn());
  } catch (err) {
    failures.push(`${label}: ${err.stack?.split("\n").slice(0, 4).join("\n      ") ?? err}`);
  }
}

/* ---------------- World ---------------- */

const item = (type, o) => makeItem(ModulusItem, ITEM_MODELS, type, o);
const fixture = (file) => JSON.parse(readFileSync(join(ROOT, "packs/_source/test-fixtures", file), "utf8"));
for (const f of ["strike.json", "grapple.json", "recuperate.json", "charging.json", "steady.json", "darting.json", "wrenching.json"]) {
  const d = fixture(f);
  const it = item(d.type, { name: d.name, system: d.system, flags: d.flags, id: d._id });
  game.items.set(it.id, it);
}
const acrobatic = item("word", { name: "Acrobatic", system: { momentumModifier: 1, penalty: -2, tierDowngrade: 1, baseWord: false, tags: [{ name: "movement", value: 0 }] } });
const exposed = item("status", { name: "Exposed", system: { value: 2, duration: { type: "untilNextTurn", rounds: 1 }, effects: [{ trigger: "while", op: "dice", args: { buff: 0, debuff: 1 }, to: "self" }] } });
const cfx = [{
  id: "cfx_1", label: "Reads the opening",
  trigger: { event: "actionUsed", actor: "other", tagsAll: ["strike", "offensive"], timing: "resolve", outcome: "hit", params: {} },
  conditions: [{ type: "momentum", who: "owner", op: "below", value: 4 }, { type: "firstUse", tagsAll: ["strike"] }],
  grant: { tierShifts: [{ stat: "physical.finesse", delta: 1 }], dice: [{ stat: "any", buff: 1, debuff: 0 }], applyTo: "self", appliesToRolls: "all" },
  duration: { rounds: 1, until: null }, stacking: "stack", maxStacks: 2, limitPerRound: 1
}, {
  id: "cfx_2", label: "Turncoat sense",
  trigger: { event: "teamChanged", actor: "other", params: { change: "switched", side: "wasAlly" } },
  conditions: [], grant: { tierShifts: [{ stat: "*", delta: 1 }], dice: [], applyTo: "self", appliesToRolls: "defense" },
  duration: { rounds: 0, until: null }, stacking: "refresh", maxStacks: 1, limitPerRound: 1
}, {
  id: "cfx_3", label: "On demand",
  trigger: { event: "manual", actor: "self", params: {} }, conditions: [],
  grant: { tierShifts: [{ stat: "rollStat", delta: 1 }], dice: [], applyTo: "self", appliesToRolls: "attack" },
  duration: { rounds: 1, until: "startOfOwnerNextTurn" }, stacking: "refresh", maxStacks: 1, limitPerRound: 1
}];
const talents = [
  item("talent", { name: "Iron Grip I", system: { talentId: "iron-grip-1", domain: "physical", tier: 1, xpCost: 20, grantsWords: ["Acrobatic"], conditionalEffects: cfx } }),
  item("talent", { name: "Iron Grip II", system: { talentId: "iron-grip-2", domain: "physical", tier: 1, xpCost: 30, requires: ["iron-grip-1"] } }),
  item("talent", { name: "Crushing Hold", system: { talentId: "crushing-hold", domain: "physical", tier: 2, xpCost: 60, prereqTalent: "iron-grip-1" } }),
  item("talent", { name: "Grand Master", system: { talentId: "grand-master", domain: "physical", tier: 3, xpCost: 120, prereqTalent: "crushing-hold", crossPrereq: "missing-one" } })
];
// Creation content (§3.7) and an advanced ancestry feature (a talent requiring the ancestry).
const aspects = [
  item("ancestry", { name: "Elf", system: { ancestryId: "elf", minorBoon: "Keen eyes", majorBoon: "Long memory", minorBane: "Frail in iron" } }),
  item("ancestry", { name: "Dwarf", system: { ancestryId: "dwarf" } }),
  item("society", { name: "The Crown", system: { xpCost: 25 } }),
  item("background", { name: "Farmhand", system: { category: "childhood" } }),
  item("background", { name: "Street urchin", system: { category: "childhood", xpCost: 15 } }),
  item("background", { name: "Smith", system: { category: "job" } }),
  item("background", { name: "Gambler", system: { category: "leisure" } }),
  item("background", { name: "Veteran", system: { category: "extra", xpCost: 40 } })
];
talents.push(item("talent", { name: "Starsight", system: { talentId: "starsight", domain: "mental", tier: 1, xpCost: 10, requiresAncestry: "elf" } }));
for (const it of [acrobatic, exposed, ...talents, ...aspects]) game.items.set(it.id, it);

const ava = makeActor(ModulusActor, CharacterData, {
  name: "Ava", id: "ava",
  system: {
    xp: { total: 650, spent: 50 },
    allocation: { domain: "physical", expression: "power", freeDot: "social.power" },
    tracks: { physical: { pipsLost: 2 }, mental: { pipsLost: 99 }, social: { pipsLost: 0 } },
    momentum: { current: 4, resistance: { physical: 1, mental: 0, social: 0 } }
  },
  items: [
    (a) => item("talent", { name: "Iron Grip I", parent: a, system: talents[0].system._source, flags: { modulus: { xpPaid: 20 } } }),
    (a) => item("status", { name: "Exposed", parent: a, system: exposed.system._source }),
    (a) => item("word", { name: "Steady", parent: a, system: { momentumModifier: -1, tags: [{ name: "slow", value: 2 }] } }),
    (a) => item("armor", { name: "Mail", parent: a, system: { equipped: true, resistance: { physical: 1 } } })
  ]
});
const bram = makeActor(ModulusActor, NPCData, {
  name: "Bram", id: "bram",
  system: { statsMode: "direct", directTiers: { physical: { power: "primary" } }, tracks: { physical: { maxOverride: 5, pipsLost: 1 } } }
});
const unset = makeActor(ModulusActor, CharacterData, { name: "Fresh", id: "fresh", system: { xp: { total: 0, spent: 0 } } });
for (const a of [ava, bram, unset]) game.actors.set(a.id, a);

/* ---------------- Encounters in each phase ---------------- */

function makeCombat(id, label, state, { kind = "standard" } = {}) {
  const combat = Object.create(ModulusCombat.prototype);
  Object.assign(combat, { id, name: label, started: state.round > 0, visible: true, combatants: new Collection(), uuid: `Combat.${id}` });
  combat.flags = { modulus: { state: JSON.stringify(state), kind, persistent: kind !== "standard" } };
  for (const [cid, actor, momentum, team] of [["ca", ava, 4, "Crown"], ["cb", bram, 6, ""]]) {
    const c = Object.create(ModulusCombatant.prototype);
    Object.assign(c, { id: cid, actor, actorId: actor.id, name: actor.name, img: actor.img, defeated: false, parent: combat, tokenId: null });
    c.flags = { modulus: { momentum, team, sceneTrack: "physical", active: true } };
    combat.combatants.set(cid, c);
  }
  game.combats.set(id, combat);
  return combat;
}

const P = [{ id: "ca", name: "Ava", momentum: 4 }, { id: "cb", name: "Bram", momentum: 6 }];
const decl = (label, o = {}) => ({
  label, actionKey: label, cost: 2, slow: 0, fast: 0, tags: "strike, offensive", tagList: [{ name: "strike", value: 0 }, { name: "offensive", value: 0 }],
  words: [], rollStat: "physical.power", targetStat: "physical.finesse", rolls: true,
  target: { kind: "actor", pid: "cb" }, payload: { actionUuid: "Item.mfxStrike0000001", wordUuids: [], target: { kind: "actor", pid: "cb" } }, ...o
});
let s = E.startRound(E.newEncounterState(), P).state;
const participation = s;
s = E.beginDeclaration(s, P, () => 0.3).state;
const declaring = s;
s = E.declare(s, "ca", decl("Strike")).state;
s = E.declare(s, "cb", decl("Strike + Steady", { slow: 3, target: { kind: "entry", entryId: s.stack[0].id } })).state;
const reconfirming = s;
s = E.beginExecution(E.beginFinalization(E.reconfirm(s, s.queue[0]?.entryId ?? "", null).state).state).state;
let fx = processEvent(newCondFxState(), { id: "e1", type: "action", round: s.round, instanceId: "C-exec", actorId: "cb", targetIds: ["ca"], tags: [{ name: "strike", value: 0 }, { name: "offensive", value: 0 }], timing: "resolve", outcome: "hit" },
  [{ ownerId: "ca", talentId: "iron-grip-1", talentName: "Iron Grip I", effects: cfx }], { instanceId: "C-exec", facts: { ca: { momentum: 2 } } }).state;
s = { ...s, condfx: fx };
s = scheduleDelayed(s, { effect: { trigger: "onHit", op: "pips", args: { delta: 1, track: "physical" }, to: "target", delay: 2 }, source: "Slow Poison", text: "Slow Poison: On hit, 2 rounds later: the target loses 1 pip of physical.", actorPid: "ca", targetPid: "cb" }).state;
const executing = s;
const r = E.resolveEntry(s, E.currentEntry(s).id, { hit: true });
const surrender = E.resolveEntry(r.state, E.currentEntry(r.state)?.id ?? "", { hit: false }).state;

const phases = { idle: E.newEncounterState(), participation, declaring, reconfirming, executing, surrender };
const combats = Object.fromEntries(Object.entries(phases).map(([k, st]) => [k, makeCombat(`C-${k}`, `Fight (${k})`, st, { kind: k === "idle" ? "relationship" : "standard" })]));

// A deck on Ava in the executing encounter.
setSetting("enableDeck", true);
ava.flags.modulus = { decks: { "C-executing": {
  draw: [{ id: "2c", rank: 2, suit: "c", marks: [] }],
  hand: [{ id: "Ah", rank: 14, suit: "h", marks: [{ type: "burn", value: 0, consumable: false }] }, { id: "X", rank: 0, suit: "x", marks: [] }, { id: "9s", rank: 9, suit: "s", marks: [{ type: "draw", value: 0, consumable: true }] }],
  discard: [], burned: [], reshuffles: 1, size: 54, pendingMomentumLoss: 3, markUses: {}
} } };
ava.items.set("deckability", item("talent", { name: "Card Sharp", parent: ava, id: "deckability", system: { talentId: "card-sharp", domain: "social", tier: 1, effects: [
  { trigger: "while", op: "pokerHand", args: { label: "Read the table", minRank: 1, consume: "selected", scaling: [{ minRank: 1, buff: 1 }, { minRank: 4, buff: 2 }] }, to: "self" },
  { trigger: "while", op: "cardMark", args: { label: "Shave", mark: { type: "burn" }, count: 2, uses: 1 }, to: "self" }
] } }));

/* ---------------- Sheets ---------------- */

for (const actor of [ava, bram, unset]) {
  for (const tab of ["main", "talents", "items", "cards", "notes"]) {
    const sheet = new ModulusActorSheet({ document: actor });
    sheet.tabGroups.primary = tab;
    if (tab === "cards") sheet._selectedCards = new Set(["Ah", "X"]);
    await renderApp(`Actor sheet ${actor.name} / ${tab}`, sheet);
  }
}

for (const type of Object.keys(ITEM_MODELS)) {
  await renderApp(`Item sheet ${type} (defaults)`, new ModulusItemSheet({ document: item(type, { name: `New ${type}` }) }));
}
const richAction = item("action", { name: "Everything", system: {
  rollStat: "physical.power", targetStat: "mental.finesse", tags: [{ name: "slow", value: 2 }, { name: "strike", value: 0 }],
  effects: [
    { trigger: "declare", op: "dice", args: { buff: 1, debuff: 0 }, to: "self" },
    { trigger: "onHit", op: "pips", args: { delta: 1, track: "physical" }, to: "target", delay: 2 },
    { trigger: "onHit", op: "team", args: { mode: "set", name: "" }, to: "target" },
    { trigger: "while", op: "deckModify", args: { add: { jokers: 1 } }, to: "self" },
    { trigger: "onMiss", op: "restrict", args: { tag: "two-handed", until: "they break free", breakRoll: "physical.power" }, to: "target" },
    { trigger: "onResolve", op: "nope", args: {}, to: "self" }
  ]
} });
await renderApp("Item sheet action (all effect kinds)", new ModulusItemSheet({ document: richAction }));
for (const t of talents) await renderApp(`Item sheet talent ${t.name}`, new ModulusItemSheet({ document: t }));
await renderApp("Item sheet word Acrobatic", new ModulusItemSheet({ document: acrobatic }));

/* ---------------- Windows ---------------- */

const vocab = new VocabularyEditor();
await renderApp("Vocabulary Editor / items", vocab);
vocab.selected.add(game.items.first().id);
vocab.filter.type = "talent";
await renderApp("Vocabulary Editor / items filtered", vocab);
vocab.tab = "tags";
await renderApp("Vocabulary Editor / tags", vocab);

const standalone = new ActionBuilder(ava);
await renderApp("Act window (no action picked)", standalone);
standalone.choice.action = "Item.mfxStrike0000001";
standalone.choice.words = [acrobatic.uuid, "Item.mfxSteady0000001", "Item.mfxDarting000001"];
await renderApp("Act window (strike + 3 words, one unknown)", standalone);
const exec = combats.executing;
const declare = new ActionBuilder(ava, { mode: "declare", combat: exec, combatant: exec.combatants.get("ca"), prefill: { actionUuid: "Item.mfxStrike0000001", wordUuids: [], target: { kind: "actor", pid: "cb" } } });
await renderApp("Declare window", declare);
const reconfirm = new ActionBuilder(ava, { mode: "reconfirm", combat: exec, combatant: exec.combatants.get("ca"), prefill: { actionUuid: "Item.mfxGrapple000001", wordUuids: [], target: { kind: "entry", entryId: exec.encounterState.stack[1]?.id } }, note: "Bram declared Slow." });
await renderApp("Re-confirm window", reconfirm);
await renderApp("Act window (NPC, no words)", new ActionBuilder(bram));

for (const [phase, combat] of Object.entries(combats)) {
  const em = new EncounterManager();
  em.selectedId = combat.id;
  await renderApp(`Encounter Manager / ${phase}`, em);
}
// Resolved stack entries are badged Resolved, not by their declaration state; titles stay one flex item.
await attempt("Encounter Manager / surrender (stack badges)", async () => {
  const em = new EncounterManager();
  em.selectedId = combats.surrender.id;
  const html = renderFile(EncounterManager.PARTS.body.template, await em._prepareContext({}));
  if (!/class="em-entry[^"]*resolved/.test(html)) throw new Error("the surrender scenario has no resolved entries");
  const badges = [...html.matchAll(/class="em-badge">([^<]*)</g)].map((m) => m[1].trim());
  if (!badges.includes("Resolved")) throw new Error(`no Resolved badge in the stack: ${badges.join(", ")}`);
  if (!/class="em-entry-title"><strong>/.test(html)) throw new Error("stack entry title is not wrapped in em-entry-title");
  return html;
});

game.user.isGM = false;
const playerView = new EncounterManager();
playerView.selectedId = combats.executing.id;
await renderApp("Encounter Manager / player view", playerView);
game.user.isGM = true;

await renderApp("Talent graph", new TalentGraph());

// Character creation: every step, with picks, a too-expensive plan, and a re-run after creation.
setSetting("creation.startingWords", 2);
const creation = new CharacterCreation(unset);
for (const step of ["stats", "ancestry", "society", "background", "word", "review"]) {
  creation.step = step;
  await renderApp(`Character creation / ${step} (empty)`, creation);
}
creation.plan.allocation = { domain: "mental", expression: "finesse", freeDot: "physical.power" };
creation.plan.ancestry = aspects[0].uuid;
creation.plan.society = [aspects[2].uuid];
creation.plan.background = [aspects[3].uuid, aspects[4].uuid, aspects[5].uuid, aspects[6].uuid, aspects[7].uuid];
creation.plan.word = [acrobatic.uuid];
for (const step of ["stats", "ancestry", "society", "background", "word", "review"]) {
  creation.step = step;
  await renderApp(`Character creation / ${step} (picked, over budget)`, creation);
}
await attempt("Character creation / review cost", async () => {
  creation.step = "review";
  const ctx = await creation._prepareContext({});
  if (ctx.review.cost !== 25 + 15 + 40) throw new Error(`cost ${ctx.review.cost}, expected 80`);
  if (ctx.valid) throw new Error("a plan costing 80 XP with 0 available should be invalid");
  return renderFile(CharacterCreation.PARTS.body.template, ctx);
});
setSetting("creation.startingWords", 0);
ava.flags.modulus.created = true;
const rerun = new CharacterCreation(ava);
rerun.step = "review";
await renderApp("Character creation / re-run (words step hidden)", rerun);
for (const tab of ["main"]) {
  const sheet = new ModulusActorSheet({ document: ava });
  sheet.tabGroups.primary = tab;
  await renderApp(`Actor sheet Ava (created) / ${tab}`, sheet);
}
delete ava.flags.modulus.created;
await attempt("Talents tab: advanced ancestry feature is locked with its reason", async () => {
  const sheet = new ModulusActorSheet({ document: ava });
  sheet.tabGroups.primary = "talents";
  const html = renderFile(ModulusActorSheet.PARTS.talents.template, await sheet._prepareContext({}));
  if (!html.includes("Needs the Elf ancestry.")) throw new Error("Starsight does not say it needs the Elf ancestry");
  return html;
});

/* ---------------- Chat cards and dialogs ---------------- */

await attempt("Roll card (encounter action with everything)", async () => {
  const roll = ModulusRoll.create({ tier: "secondary", buff: 1, debuff: 2, flatBonus: -1, dc: 11, context: {
    label: "Strike + Acrobatic", actorName: "Ava", statKey: "physical.power", statLabel: "Strength", baseTier: "primary", tier: "secondary",
    defeatedTracks: 1, extraDebuff: 0, dcSource: { kind: "target", targetName: "Bram", statLabel: "Dexterity", tier: "secondary", defeatedTracks: 0 },
    talentEffects: [{ label: "Reads the opening", talent: "Iron Grip I", event: "Action used", shifts: "+1 Dexterity", dice: "+1▲", defense: false }],
    action: {
      tags: "strike, offensive", cost: 3, rollStat: "Strength", targetStat: "Dexterity",
      onHit: ["Strike: On hit: the target loses 1 pip."], onMiss: [], onResolve: [],
      flatLines: [{ label: "Acrobatic (not known)", value: "−2", penalty: true }, { label: "Duelist", value: "+1", penalty: false }],
      unknownWords: ["Acrobatic (not known): −1 tier"], tierShifts: []
    }
  } });
  await roll.evaluate();
  return roll.render();
});
await attempt("Roll card (manual stat roll)", async () => {
  const roll = ModulusRoll.create({ tier: "primary", buff: 0, debuff: 0, flatBonus: 0, dc: null, context: { label: "Strength", statLabel: "Strength", baseTier: "primary", tier: "primary" } });
  await roll.evaluate();
  return roll.render();
});
await attempt("Action card (no roll)", async () => renderFile("templates/chat/action-card.hbs", { ctx: { label: "Recuperate", action: { tags: "recovery", cost: 0, onResolve: ["Recuperate: On resolution: set your momentum to 3."] } } }));
await attempt("Hand card", async () => renderFile("templates/chat/hand-card.hbs", {
  actor: "Ava", ability: "Read the table", hand: { rank: 2, rankUp: 1 }, handName: "Two pair", baseName: "Pair",
  cards: [{ id: "Ah", rank: "A", suit: "♥", red: true, marks: [{ icon: "fa-fire" }], markTooltip: "Burn" }],
  burned: 2, drawn: 1, drawShort: 0, reshuffled: 1, stripped: 1, consume: "selected", grant: [{ key: "buff", value: 1 }]
}));
await attempt("Roll dialog", async () => renderFile("templates/dialog/roll-dialog.hbs", {
  stats: { "physical.power": "Strength" }, statKey: "physical.power", buff: 0, debuff: 0, flatBonus: 0, dc: 11, dcMode: "manual", targetStat: "physical.finesse", targetName: null,
  dcModes: { manual: "MODULUS.Roll.DCMode.manual", target: "MODULUS.Roll.DCMode.target", none: "MODULUS.Roll.DCMode.none" }
}));

/* ---------------- Report ---------------- */

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`render-check: ${failures.length} problem(s) in ${rendered} rendered parts`);
  process.exit(1);
}
console.log(`render-check: ${rendered} parts rendered clean`);
