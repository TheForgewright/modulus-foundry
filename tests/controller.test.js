// End-to-end round through the real GM controller with mocked Foundry documents (§18 Phase 3).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock, Collection } from "./harness/foundry-mock.js";
import { SETTING_DEFAULTS } from "../module/settings.js";
import { newEncounterState } from "../module/rules/encounter.js";
import { effectiveTier, dcForTier } from "../module/rules/tier.js";

let mock;
let encounterController;
let items;

/** Plain item stand-ins (the controller reads `.name`, `.uuid`, `.system`). */
function item(uuid, name, type, system) {
  return { uuid, name, type, system: { tags: [], effects: [], ...system } };
}

function makeActor(name, tiers = {}) {
  return {
    name,
    uuid: `Actor.${name}`,
    items: new Collection(),
    system: {
      maxWords: 2,
      momentum: { current: 0, starting: 3, gainPerTurn: 1, ceiling: 8, resistance: { physical: 1, mental: 0, social: 0 } },
      defeatedTracks: 0,
      allDepleted: false
    },
    getEffectiveTier(key, { shifts = [] } = {}) {
      const base = tiers[key] ?? "secondary";
      const r = effectiveTier({ baseTier: base, shifts });
      return { ...r, baseTier: base, defeatedTracks: 0 };
    },
    getDefenseDC(key, { shifts = [] } = {}) {
      const r = this.getEffectiveTier(key, { shifts });
      return { dc: dcForTier(r.tier), tier: r.tier, defeatedTracks: 0 };
    },
    applyPips: async () => {}
  };
}

function makeCombat(participants) {
  let state = JSON.stringify(newEncounterState());
  const combatants = new Collection();
  const combat = {
    id: "C1",
    label: "Test fight",
    started: false,
    combatants,
    async startCombat() { this.started = true; },
    get encounterState() { return JSON.parse(state); },
    async saveEncounterState(s) { state = JSON.stringify(s); }
  };
  for (const [id, actor, momentum] of participants) {
    combatants.set(id, {
      id, name: actor.name, actor, defeated: false, participating: true, sceneTrack: "", playerOwners: [], parent: combat,
      momentum,
      async setMomentum(v) { this.momentum = v; },
      async adjustMomentum(d) { this.momentum += d; },
      async setFlag() {}
    });
  }
  return combat;
}

before(async () => {
  mock = installFoundryMock({ settingDefaults: SETTING_DEFAULTS });
  items = new Map([
    item("I.strike", "Strike", "action", { rollStat: "physical.power", targetStat: "physical.finesse", momentumCost: 1, rolls: true, tags: [{ name: "strike", value: 0 }, { name: "offensive", value: 0 }] }),
    item("I.steady", "Steady", "word", { momentumModifier: -1, tags: [{ name: "slow", value: 2 }] }),
    item("I.darting", "Darting", "word", { momentumModifier: 1, tags: [{ name: "fast", value: 1 }] }),
    item("I.parry", "Parry", "action", { rollStat: "physical.finesse", targetStat: "", momentumCost: 1, rolls: false, tags: [{ name: "duelist", value: 2 }] })
  ].map((i) => [i.uuid, i]));
  globalThis.fromUuid = async (u) => items.get(u) ?? null;
  globalThis.fromUuidSync = (u) => items.get(u) ?? null;
  ({ encounterController } = await import("../module/encounter/controller.js"));
});

const strike = (target, words = []) => ({ type: "declare", payload: { actionUuid: "I.strike", wordUuids: words, target } });

test("a full round: order, declare, Slow cascade, re-confirm, Duelist, resolve top to bottom, spend, end", async () => {
  const A = makeActor("Ava"), B = makeActor("Bram"), C = makeActor("Cass");
  const combat = makeCombat([["a", A, 4], ["b", B, 6], ["c", C, 7]]);
  const ctl = encounterController(combat);

  await ctl.startRound();
  assert.equal(combat.encounterState.phase, "participation");
  await ctl.beginDeclarations();
  let s = combat.encounterState;
  assert.deepEqual(s.order, ["a", "b", "c"]);
  assert.equal(ctl.currentStep().pid, "a");

  // NPCs: the GM answers through the same submit path a player's query would.
  await ctl.submitDeclaration("a", strike({ kind: "actor", pid: "c" }));
  await ctl.submitDeclaration("b", strike({ kind: "actor", pid: "a" }));
  // Cass declares Strike + Steady (slow 2): effective 5, below Bram (6) -> Bram must re-confirm.
  await ctl.submitDeclaration("c", strike({ kind: "actor", pid: "b" }, ["I.steady"]));
  s = combat.encounterState;
  assert.equal(s.stack.find((e) => e.pid === "c").state, "LOCKED");
  assert.equal(ctl.currentStep().type, "reconfirm");
  assert.equal(ctl.waitingOn().name, "Bram");

  // Bram changes to a Fast strike instead.
  await ctl.submitReconfirm(ctl.currentStep().entryId, strike({ kind: "actor", pid: "a" }, ["I.darting"]));
  s = combat.encounterState;
  assert.equal(s.stack.find((e) => e.pid === "b").effective, 7);
  assert.equal(s.phase, "executing"); // no duelists: finalization passes straight through

  // Resolve top to bottom: Bram (7), Cass (5), Ava (4).
  const order = [];
  for (let i = 0; i < 3; i++) {
    const before = combat.encounterState;
    const id = before.execOrder[before.execCursor];
    order.push(before.stack.find((e) => e.id === id).pid);
    await ctl.resolveNext();
  }
  assert.deepEqual(order, ["b", "c", "a"]);
  assert.equal(combat.encounterState.phase, "surrender");

  // Costs spent at resolution: Strike 1 + target resistance 1, +1 Darting / -1 Steady.
  const m = Object.fromEntries(combat.combatants.map((x) => [x.id, x.momentum]));
  assert.deepEqual(m, { a: 4 - 2, b: 6 - 3, c: 7 - 1 });
  assert.equal(mock.messages.filter((x) => x.rolls).length, 3);

  await ctl.endRound();
  assert.equal(combat.encounterState.phase, "idle");
  await ctl.startRound(); // round 2: gain 1, capped at the ceiling
  assert.equal(combat.encounterState.round, 2);
  assert.deepEqual(Object.fromEntries(combat.combatants.map((x) => [x.id, x.momentum])), { a: 3, b: 4, c: 7 });
});

test("invalid declarations are rejected and the step stays open; passing advances", async () => {
  const A = makeActor("Dax"), B = makeActor("Eli");
  const combat = makeCombat([["d", A, 0], ["e", B, 5]]);
  combat.id = "C2";
  const ctl = encounterController(combat);
  await ctl.startRound();
  await ctl.beginDeclarations();
  await ctl.submitDeclaration("d", strike({ kind: "actor", pid: "e" })); // 0 momentum, not Recovery
  assert.equal(ctl.currentStep().pid, "d");
  assert.ok(mock.messages.some((x) => x.warn && x.warn.includes("needsRecovery")));
  await ctl.submitDeclaration("d", { type: "pass" });
  assert.equal(ctl.currentStep().pid, "e");
});

test("Duelist asks for a drop; interrupts cancel without spending", async () => {
  const A = makeActor("Fen"), B = makeActor("Gil");
  const combat = makeCombat([["f", A, 5], ["g", B, 8]]);
  combat.id = "C3";
  const ctl = encounterController(combat);
  await ctl.startRound();
  await ctl.beginDeclarations();
  await ctl.submitDeclaration("f", strike({ kind: "actor", pid: "g" }));
  await ctl.submitDeclaration("g", { type: "declare", payload: { actionUuid: "I.parry", wordUuids: [], target: { kind: "none" } } });
  assert.equal(combat.encounterState.phase, "finalization");
  assert.equal(ctl.currentStep().type, "duelist");
  await ctl.submitDuelist(ctl.currentStep().entryId, 2);
  const g = combat.encounterState.stack.find((e) => e.pid === "g");
  assert.equal(g.effective, 6);
  assert.equal(g.duelistBonus, 2);
  assert.equal(combat.encounterState.phase, "executing");
  await ctl.interrupt(combat.encounterState.stack.find((e) => e.pid === "f").id);
  await ctl.resolveNext(); // Gil
  assert.equal(combat.encounterState.phase, "surrender");
  assert.equal(combat.combatants.get("f").momentum, 5); // interrupted: nothing spent
  assert.equal(combat.combatants.get("g").momentum, 7);
});

test("talents: a conditional effect triggered at declaration raises the defender's DC at resolution, shows on the card, and expires at round end", async () => {
  const A = makeActor("Hal"), B = makeActor("Ida");
  // Ida: when another participant declares an action targeting her, +1 tier in physical finesse (defense) this round.
  B.items.set("t1", {
    id: "t1", type: "talent", name: "Braced When Marked",
    system: { talentId: "braced", conditionalEffects: [{
      id: "cfx_1", label: "Braced",
      trigger: { event: "actionTargeted", actor: "other" },
      grant: { tierShifts: [{ stat: "physical.finesse", delta: 1 }], appliesToRolls: "defense" },
      duration: { rounds: 1 }
    }] }
  });
  const combat = makeCombat([["h", A, 5], ["i", B, 4]]);
  combat.id = "C4";
  const ctl = encounterController(combat);
  await ctl.startRound();
  await ctl.beginDeclarations();
  await ctl.submitDeclaration("i", { type: "pass" });
  const before = mock.messages.length;
  await ctl.submitDeclaration("h", strike({ kind: "actor", pid: "i" }));
  const fx = combat.encounterState.condfx.instances;
  assert.equal(fx.length, 1);
  assert.equal(fx[0].applyToId, "i");
  assert.ok(mock.messages.slice(before).some((m) => String(m.content ?? "").includes("Braced")));

  await ctl.resolveNext();
  const roll = mock.messages.filter((m) => m.rolls).at(-1).rolls[0];
  assert.equal(roll.options.modulus.dc, 14); // secondary finesse 11 -> primary 14
  const sources = roll.options.modulus.context.talentEffects;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].defense, true);

  await ctl.endRound();
  assert.equal(combat.encounterState.condfx.instances.length, 0);
});

test("change team outcome sets the apparent team in the encounter", async () => {
  const { applyEffect } = await import("../module/encounter/outcomes.js");
  const flags = {};
  const mk = (id, team) => ({ id, team, async setFlag(ns, key, v) { flags[id] = v; this.team = v; } });
  const spy = mk("s", ""), mark = mk("m", "Crown"), boss = mk("b", "Guild");
  const run = (args, to, actorCombatant, targetCombatant) => applyEffect({ op: "team", args, to }, { actorCombatant, targetCombatant, actor: {}, target: {} });
  await run({ mode: "joinTarget" }, "self", spy, mark);      // infiltrate: the spy takes the mark's apparent side
  assert.equal(spy.team, "Crown");
  await run({ mode: "joinActor" }, "target", boss, mark);    // recruit: the mark joins the boss
  assert.equal(mark.team, "Guild");
  await run({ mode: "clear" }, "self", spy, mark);           // vanish into stealth
  assert.equal(spy.team, "");
  await run({ mode: "set", name: "Rebels" }, "target", boss, mark);
  assert.equal(mark.team, "Rebels");
});

test("delayed effects: scheduled from the outcome button, fire at the start of the due round, and can be cancelled", async () => {
  const A = makeActor("Jin"), B = makeActor("Kat");
  const combat = makeCombat([["j", A, 5], ["k", B, 6]]);
  combat.id = "C5";
  const ctl = encounterController(combat);
  await ctl.startRound(); // round 1
  const { applyOutcome } = await import("../module/encounter/outcomes.js");
  // An outcome card whose effect is "on resolution, 2 rounds later: you gain 3 momentum".
  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: A }),
    flags: { modulus: { context: { encounter: { combatId: "C5" }, outcomeEffects: [
      { trigger: "onResolve", source: "Second Wind", text: "Second Wind: On resolution, 2 rounds later: you gain 3 momentum.", effect: { trigger: "onResolve", op: "momentum", args: { delta: 3 }, to: "self", delay: 2 } }
    ] } } }
  });
  game.combats.set("C5", combat);
  await applyOutcome(card, 0);
  assert.equal(card.flags.modulus.applied[0], "scheduled");
  assert.equal(combat.encounterState.delayed.length, 1);
  assert.equal(combat.encounterState.delayed[0].dueRound, 3);
  assert.equal(combat.combatants.get("j").momentum, 5); // nothing yet

  mock.settings.set("autoApplyOutcomes", true);
  try {
    await ctl.endRound();
    await ctl.startRound(); // round 2: not due
    assert.equal(combat.combatants.get("j").momentum, 6); // only the round-2 gain
    await ctl.endRound();
    await ctl.startRound(); // round 3: fires
    assert.equal(combat.combatants.get("j").momentum, 7 + 3);
    assert.equal(combat.encounterState.delayed.length, 0);
  } finally {
    mock.settings.set("autoApplyOutcomes", false);
  }

  await ctl.scheduleDelayed({ effect: { trigger: "onResolve", op: "momentum", args: { delta: 9 }, to: "self", delay: 1 }, actorPid: "j", source: "Dispelled" });
  await ctl.cancelDelayed(combat.encounterState.delayed[0].id);
  await ctl.endRound();
  await ctl.startRound();
  assert.equal(combat.combatants.get("j").momentum, 10); // above the ceiling, so no gain; the cancelled +9 never came
});

test("linked encounters: one action's momentum changes apply in every linked encounter, once each", async () => {
  const A = makeActor("Lio"), B = makeActor("Mae"), C = makeActor("Ned");
  const fight = makeCombat([["l", A, 5], ["m", B, 6]]);
  fight.id = "C6";
  const bond = makeCombat([["l2", A, 2], ["m2", B, 4]]);
  bond.id = "C7";
  const other = makeCombat([["l3", A, 1], ["n3", C, 1]]); // only the actor is here
  other.id = "C8";
  const elsewhere = makeCombat([["n4", C, 0]]); // neither is here
  elsewhere.id = "C9";
  for (const c of [fight, bond, other, elsewhere]) game.combats.set(c.id, c);
  const { applyOutcome, setLinked, linkCandidates } = await import("../module/encounter/outcomes.js");
  globalThis.fromUuidSync = (u) => (u === B.uuid ? B : items.get(u) ?? null);
  // Cost 2 already paid in the fight; on hit the target loses 1 momentum; on resolution you gain 1.
  const card = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: A }),
    rolls: [{ options: { modulus: { hit: true, context: {
      label: "Taunt", encounter: { combatId: "C6" }, targetUuid: B.uuid, costSpent: true, action: { cost: 2 },
      outcomeEffects: [
        { trigger: "onHit", source: "Taunt", text: "", effect: { trigger: "onHit", op: "momentum", args: { delta: -1 }, to: "target" } },
        { trigger: "onResolve", source: "Taunt", text: "", effect: { trigger: "onResolve", op: "momentum", args: { delta: 1 }, to: "self" } }
      ]
    } } } }]
  });
  assert.deepEqual(linkCandidates(card).map((x) => x.combat.id), ["C7", "C8"]);
  await applyOutcome(card, 0);
  assert.equal(fight.combatants.get("m").momentum, 5);
  // Linking afterwards catches the linked encounters up: the cost and the applied outcome.
  await setLinked(card, ["C7", "C8"]);
  assert.equal(bond.combatants.get("l2").momentum, 0);
  assert.equal(bond.combatants.get("m2").momentum, 3);
  assert.equal(other.combatants.get("l3").momentum, -1);
  assert.equal(other.combatants.get("n3").momentum, 1); // not the target
  // Re-linking applies nothing twice.
  await setLinked(card, ["C7", "C8"]);
  assert.equal(bond.combatants.get("l2").momentum, 0);
  // An outcome applied after linking goes to every linked encounter at once.
  await applyOutcome(card, 1);
  assert.deepEqual([fight.combatants.get("l").momentum, bond.combatants.get("l2").momentum, other.combatants.get("l3").momentum], [6, 1, 0]);
  assert.equal(elsewhere.combatants.get("n4").momentum, 0);
});
