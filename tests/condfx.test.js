// Conditional effects (§8.1): tests 15-20 of §17.2.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  processEvent, activeModifiers, expireEffects, consumeUsed, newCondFxState, breakPointEvents, sceneTrackEvent,
  describeCondFx, validateCondFx, matchTrigger, normalizeCondFx
} from "../module/rules/condfx.js";
import { effectiveTier } from "../module/rules/tier.js";

let n = 0;
const action = (o) => ({ id: `ev${++n}`, type: "action", round: 2, instanceId: "C1", actorId: "me", targetIds: [], tags: [], words: [], timing: "resolve", outcome: "hit", rollStat: "physical.power", targetStat: "physical.finesse", ...o });
const tags = (...names) => names.map((name) => ({ name, value: 0 }));
const talent = (effects, o = {}) => ({ ownerId: "me", talentId: "t1", talentName: "Reads the opening", effects, ...o });
const ctx = { instanceId: "C1", participants: ["me", "foe", "pal"] };

const strikeHit = {
  id: "cfx_01", label: "Reads the opening",
  trigger: { event: "actionUsed", actor: "self", tagsAll: ["strike"], timing: "resolve", outcome: "hit" },
  grant: { tierShifts: [{ stat: "physical.finesse", delta: 1 }] },
  duration: { rounds: 1 }
};

const tierOf = (state, base, stat = "physical.finesse", actor = "me") =>
  effectiveTier({ baseTier: base, shifts: activeModifiers(state, actor, stat).shifts }).tier;

test("test 15: own strike hit -> +1 tier in finesse for the rest of the round, gone next round", () => {
  let s = newCondFxState();
  s = processEvent(s, action({ round: 2, tags: tags("strike", "offensive") }), [talent([strikeHit])], ctx).state;
  assert.equal(tierOf(s, "secondary"), "primary"); // later that round
  s = expireEffects(s, { at: "roundEnd", round: 2 });
  assert.equal(tierOf(s, "secondary"), "secondary"); // round 3
});

test("test 15: extra tags still match; a hit lacking strike does not; a miss does not", () => {
  const t = [talent([strikeHit])];
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike", "offensive", "magic") }), t, ctx).applied.length, 1);
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("offensive") }), t, ctx).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike"), outcome: "miss" }), t, ctx).applied.length, 0);
});

test("test 16: another participant declaring control + offensive; control alone does not; own action never matches 'other'", () => {
  const def = { id: "c1", trigger: { event: "actionUsed", actor: "other", tagsAll: ["control", "offensive"], timing: "declare" }, grant: { tierShifts: [{ stat: "physical.resilience", delta: 1 }] } };
  const t = [talent([def])];
  assert.equal(processEvent(newCondFxState(), action({ actorId: "foe", timing: "declare", outcome: null, tags: tags("control", "offensive") }), t, ctx).applied.length, 1);
  assert.equal(processEvent(newCondFxState(), action({ actorId: "foe", timing: "declare", outcome: null, tags: tags("control") }), t, ctx).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), action({ actorId: "me", timing: "declare", outcome: null, tags: tags("control", "offensive") }), t, ctx).applied.length, 0);
  // declare-timing effects ignore resolve events
  assert.equal(processEvent(newCondFxState(), action({ actorId: "foe", tags: tags("control", "offensive") }), t, ctx).applied.length, 0);
});

test("test 17: breakPointHit fires once per break point reached, not per pip afterwards", () => {
  assert.equal(breakPointEvents({ before: 0, after: 3, perLevel: 3, actorId: "me", track: "physical", round: 1 }).length, 1);
  assert.equal(breakPointEvents({ before: 3, after: 4, perLevel: 3, actorId: "me", track: "physical", round: 1 }).length, 0);
  assert.equal(breakPointEvents({ before: 2, after: 6, perLevel: 3, actorId: "me", track: "physical", round: 1 }).length, 2);
  const self = { id: "b", trigger: { event: "breakPointHit", actor: "self", params: { track: "physical" } }, grant: { tierShifts: [{ stat: "*", delta: 1 }] }, limitPerRound: 0 };
  const other = { id: "o", trigger: { event: "breakPointHit", actor: "other", params: { track: "any" } }, grant: { tierShifts: [{ stat: "*", delta: 1 }] } };
  const evs = breakPointEvents({ before: 2, after: 6, perLevel: 3, actorId: "me", track: "physical", round: 1, instanceId: "C1" });
  let s = newCondFxState();
  let fires = 0;
  for (const e of evs) {
    const r = processEvent(s, e, [talent([self])], ctx);
    fires += r.applied.length;
    s = r.state;
  }
  assert.equal(fires, 2);
  assert.equal(processEvent(newCondFxState(), evs[0], [talent([other])], ctx).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), { ...evs[0], actorId: "foe" }, [talent([other])], ctx).applied.length, 1);
  const mental = { ...evs[0], params: { track: "mental" } };
  assert.equal(processEvent(newCondFxState(), mental, [talent([self])], ctx).applied.length, 0);
});

test("test 17: sceneTrackChanged fires for the encounter-start choice (from none) and later changes; same track does nothing", () => {
  const def = { id: "s", trigger: { event: "sceneTrackChanged", actor: "self", params: { to: "drama" } }, grant: { tierShifts: [{ stat: "social.*", delta: 1 }] }, limitPerRound: 0 };
  const first = sceneTrackEvent({ from: "", to: "social", actorId: "me", round: 1, instanceId: "C1" });
  assert.equal(processEvent(newCondFxState(), first, [talent([def])], ctx).applied.length, 1);
  const fromNone = { ...def, trigger: { ...def.trigger, params: { to: "any", from: "none" } } };
  assert.equal(processEvent(newCondFxState(), first, [talent([fromNone])], ctx).applied.length, 1);
  const later = sceneTrackEvent({ from: "physical", to: "social", actorId: "me", round: 3, instanceId: "C1" });
  assert.equal(processEvent(newCondFxState(), later, [talent([def])], ctx).applied.length, 1);
  assert.equal(processEvent(newCondFxState(), later, [talent([fromNone])], ctx).applied.length, 0);
  assert.equal(sceneTrackEvent({ from: "social", to: "social", actorId: "me", round: 3 }), null);
});

test("test 18: duration 0 is consumed by the next roll; refresh does not double; stack with maxStacks 2 does; limitPerRound", () => {
  const once = { ...strikeHit, id: "z", duration: { rounds: 0 } };
  let s = processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([once])], ctx).state;
  const mods = activeModifiers(s, "me", "physical.finesse");
  assert.deepEqual(mods.shifts, [1]);
  s = consumeUsed(s, mods.sources.map((i) => i.id));
  assert.deepEqual(activeModifiers(s, "me", "physical.finesse").shifts, []);

  const refresh = { ...strikeHit, limitPerRound: 0 };
  s = newCondFxState();
  for (let i = 0; i < 2; i++) s = processEvent(s, action({ tags: tags("strike") }), [talent([refresh])], ctx).state;
  assert.deepEqual(activeModifiers(s, "me", "physical.finesse").shifts, [1]);

  const stack = { ...strikeHit, stacking: "stack", maxStacks: 2, limitPerRound: 0 };
  s = newCondFxState();
  for (let i = 0; i < 3; i++) s = processEvent(s, action({ tags: tags("strike") }), [talent([stack])], ctx).state;
  assert.deepEqual(activeModifiers(s, "me", "physical.finesse").shifts, [2]);

  const limited = { ...strikeHit, stacking: "stack", maxStacks: 5, limitPerRound: 1 };
  s = newCondFxState();
  let fires = 0;
  for (let i = 0; i < 3; i++) {
    const r = processEvent(s, action({ tags: tags("strike") }), [talent([limited])], ctx);
    fires += r.applied.length;
    s = r.state;
  }
  assert.equal(fires, 1);
  // the limit resets next round
  s = expireEffects(s, { at: "roundEnd", round: 2 });
  assert.equal(processEvent(s, action({ round: 3, tags: tags("strike") }), [talent([limited])], ctx).applied.length, 1);
});

test("default duration lasts to end of round, so an effect from an early declaration applies to later resolutions", () => {
  const onDeclare = { id: "d", trigger: { event: "actionUsed", actor: "self", tagsAll: ["strike"], timing: "declare" }, grant: { tierShifts: [{ stat: "rollStat", delta: 1 }] } };
  const s = processEvent(newCondFxState(), action({ timing: "declare", outcome: null, tags: tags("strike") }), [talent([onDeclare])], ctx).state;
  assert.deepEqual(activeModifiers(s, "me", "physical.power").shifts, [1]); // rollStat resolved to physical.power
  assert.deepEqual(activeModifiers(s, "me", "mental.power").shifts, []);
});

test("test 19: clamping; degradation and shifts sum before clamping", () => {
  assert.equal(effectiveTier({ baseTier: "tertiary", shifts: [2] }).tier, "primary");
  const low = effectiveTier({ baseTier: "tertiary", shifts: [-1] });
  assert.equal(low.tier, "tertiary");
  assert.equal(low.extraDebuffDice, 1);
  assert.equal(effectiveTier({ baseTier: "primary", shifts: [1] }).tier, "primary");
  assert.equal(effectiveTier({ baseTier: "secondary", defeatedTracks: 2, shifts: [1] }).tier, "tertiary");
});

test("test 20: an effect applied by a trigger does not trigger others unless the trigger is tierChanged; recursion stops at depth 3", () => {
  const first = { ...strikeHit, id: "a" };
  const onRound = { id: "b", trigger: { event: "roundStart", actor: "any" }, grant: { tierShifts: [{ stat: "*", delta: 1 }] } };
  const r1 = processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([first, onRound])], ctx);
  assert.deepEqual(r1.applied.map((i) => i.effectId), ["a"]);

  // A tierChanged effect that grants a tier shift re-triggers itself; depth cuts it at 3.
  const chain = { id: "c", trigger: { event: "tierChanged", actor: "self" }, grant: { tierShifts: [{ stat: "*", delta: 1 }] }, stacking: "stack", maxStacks: 99, limitPerRound: 0 };
  const r2 = processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([first, chain])], ctx, { chainDepth: 3 });
  const inst = r2.state.instances.find((i) => i.effectId === "c");
  assert.equal(inst.stacks, 3);
  const r3 = processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([first, chain])], ctx, { chainDepth: 0 });
  assert.equal(r3.state.instances.some((i) => i.effectId === "c"), false);
});

test("applyTo: triggering actor and target; defense uses shifts unless disabled; attack-only shifts skip defense", () => {
  const punish = { id: "p", trigger: { event: "actionHit", actor: "other", params: { victim: "self" } }, grant: { tierShifts: [{ stat: "*", delta: -1 }], applyTo: "triggeringActor", appliesToRolls: "attack" } };
  const s = processEvent(newCondFxState(), action({ actorId: "foe", targetIds: ["me"], tags: tags("strike") }), [talent([punish])], ctx).state;
  assert.deepEqual(activeModifiers(s, "foe", "physical.power").shifts, [-1]);
  assert.deepEqual(activeModifiers(s, "foe", "physical.power", { mode: "defense" }).shifts, []);
  const guard = { id: "g", trigger: { event: "actionTargeted", actor: "other" }, grant: { tierShifts: [{ stat: "physical.*", delta: 1 }] } };
  const g = processEvent(newCondFxState(), action({ actorId: "foe", targetIds: ["me"], timing: "declare", outcome: null }), [talent([guard])], ctx).state;
  assert.deepEqual(activeModifiers(g, "me", "physical.finesse", { mode: "defense" }).shifts, [1]);
  assert.deepEqual(activeModifiers(g, "me", "physical.finesse", { mode: "defense", shiftsAffectDefense: false }).shifts, []);
});

test("conditions, other instances and disabled triggers", () => {
  const def = { ...strikeHit, conditions: [{ type: "momentum", who: "owner", op: "below", value: 3 }] };
  const facts = (m) => ({ ...ctx, facts: { me: { momentum: m } } });
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([def])], facts(2)).applied.length, 1);
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([def])], facts(5)).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike"), instanceId: "C9" }), [talent([strikeHit])], ctx).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), action({ tags: tags("strike") }), [talent([strikeHit])], { ...ctx, disabledTriggers: ["actionUsed"] }).applied.length, 0);
  const first = { ...strikeHit, trigger: { ...strikeHit.trigger, timing: "declare", outcome: "any" }, conditions: [{ type: "firstUse", tagsAll: ["strike"] }], limitPerRound: 0 };
  let s = newCondFxState();
  let r = processEvent(s, action({ timing: "declare", outcome: null, tags: tags("strike") }), [talent([first])], ctx);
  assert.equal(r.applied.length, 1);
  r = processEvent(r.state, action({ timing: "declare", outcome: null, tags: tags("strike") }), [talent([first])], ctx);
  assert.equal(r.applied.length, 0);
});

test("global events (round start) match whatever the actor scope; round params filter", () => {
  const def = { id: "r", trigger: { event: "roundStart", actor: "self", params: { round: 3 } }, grant: { tierShifts: [{ stat: "*", delta: 1 }] } };
  const ev = (round) => ({ id: `r${round}`, type: "roundStart", round, instanceId: "C1", targetIds: [] });
  assert.equal(processEvent(newCondFxState(), ev(2), [talent([def])], ctx).applied.length, 0);
  assert.equal(processEvent(newCondFxState(), ev(3), [talent([def])], ctx).applied.length, 1);
});

test("plain-language preview and gating check", () => {
  const def = { trigger: { event: "actionUsed", actor: "other", tagsAll: ["strike", "offensive"], timing: "resolve", outcome: "hit" }, grant: { tierShifts: [{ stat: "physical.finesse", delta: 1 }] } };
  assert.equal(describeCondFx(def, { stat: () => "Physical Finesse" }),
    "When another character resolves a hit with strike + offensive, you gain +1 tier in Physical Finesse until the end of the round.");
  assert.deepEqual(validateCondFx({}).errors, ["noTrigger", "emptyGrant"]);
  assert.ok(validateCondFx({ trigger: { event: "roundStart" }, grant: { tierShifts: [{ stat: "*", delta: 1 }] } }).warnings.includes("passiveBonus"));
  assert.deepEqual(validateCondFx(def), { errors: [], warnings: [] });
  assert.equal(normalizeCondFx({}).limitPerRound, 1);
  assert.equal(matchTrigger(action({}), normalizeCondFx({ trigger: { event: "nope" } }), "me"), false);
});
