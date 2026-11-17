// Encounter stack (§7): tests 5-10 and 14 of §17.2.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newEncounterState, startRound, beginDeclaration, nextStep, declare, pass, reconfirm, cascadePrompts,
  beginFinalization, applyDuelist, beginExecution, currentEntry, resolveEntry, cancelEntry, endRound,
  resolutionOrder, surrenderFlags, CASCADE_GUARD
} from "../module/rules/encounter.js";

/** RNG that yields d20 results in sequence. */
const dice = (...rolls) => { let i = 0; return () => (rolls[i++ % rolls.length] - 1) / 20 + 0.001; };
const P = (id, momentum) => ({ id, name: id, momentum });
const decl = (o = {}) => ({ label: o.label ?? "Strike", actionKey: o.actionKey ?? "strike", cost: 1, slow: 0, fast: 0, target: { kind: "none" }, ...o });

function setup(participants, rng = dice(10)) {
  let s = startRound(newEncounterState(), participants).state;
  return beginDeclaration(s, participants, rng).state;
}

function declareAll(s, pids, d = () => decl()) {
  for (const pid of pids) {
    const r = declare(s, pid, d(pid));
    assert.deepEqual(r.errors, [], `${pid}: ${JSON.stringify(r.errors)}`);
    s = r.state;
  }
  return s;
}

test("test 5: order ascending; ties roll, re-rolling equal results; winner declares later, resolves earlier", () => {
  const ps = [P("A", 4), P("B", 6), P("C", 7), P("E", 8), P("D", 8), P("F", 9)];
  const { state, rolloffs } = beginDeclaration(startRound(newEncounterState(), ps).state, ps, dice(11, 11, 15, 9));
  assert.equal(rolloffs.length, 1);
  const r = state.rolls;
  assert.deepEqual([r.E, r.D].sort(), [15, 9].sort());
  const winner = r.E > r.D ? "E" : "D";
  const loser = winner === "E" ? "D" : "E";
  assert.deepEqual(state.order, ["A", "B", "C", loser, winner, "F"]);
  // resolution: winner above loser
  const s = declareAll(state, state.order);
  const order = resolutionOrder(s).map((e) => e.pid);
  assert.ok(order.indexOf(winner) < order.indexOf(loser));
  assert.deepEqual(order, ["F", winner, loser, "C", "B", "A"]);
});

function sixWithELosing() {
  const ps = [P("A", 4), P("B", 6), P("C", 7), P("E", 8), P("D", 8), P("F", 9)];
  // E then D roll: E 5, D 12 -> E lost the rolloff and declares first.
  return beginDeclaration(startRound(newEncounterState(), ps).state, ps, dice(5, 12)).state;
}

test("test 6: Slow 3 from D prompts B, C, E (ascending); not A, F or D", () => {
  let s = sixWithELosing();
  assert.deepEqual(s.order, ["A", "B", "C", "E", "D", "F"]);
  s = declareAll(s, ["A", "B", "C", "E"]);
  const r = declare(s, "D", decl({ slow: 3 }));
  const names = (ids) => ids.map((id) => r.state.stack.find((e) => e.id === id).pid);
  assert.deepEqual(names(r.prompted), ["B", "C", "E"]);
  const d = r.state.stack.find((e) => e.pid === "D");
  assert.equal(d.effective, 5);
  assert.equal(d.state, "LOCKED");
  assert.deepEqual(nextStep(r.state), { type: "reconfirm", ...r.state.queue[0] });
  assert.equal(r.state.queue[0].pid, "B");
});

test("re-confirmation is not decided by momentum alone: equal momentum, different states", () => {
  // E (lost rolloff, declared) is prompted; D's equal-momentum rival F-style pending participants are not.
  let s = sixWithELosing();
  s = declareAll(s, ["A", "B", "C", "E"]);
  const r = declare(s, "D", decl({ slow: 1 })); // insertion 7, tie with C
  const prompted = r.prompted.map((id) => r.state.stack.find((e) => e.id === id).pid);
  assert.ok(prompted.includes("E"));
  assert.ok(!prompted.includes("F"));
});

test("test 7: a Locked entry above the insertion point is auto-confirmed, never prompted", () => {
  const ps = [P("A", 3), P("B", 6), P("C", 7), P("D", 8)];
  let s = setup(ps);
  s = declareAll(s, ["A", "B"]);
  let r = declare(s, "C", decl({ slow: 2 })); // C effective 5, Locked; prompts B (6)
  assert.equal(r.state.stack.find((e) => e.pid === "C").state, "LOCKED");
  s = reconfirm(r.state, r.state.queue[0].entryId, null).state;
  r = declare(s, "D", decl({ slow: 4 })); // D effective 4
  const prompted = r.prompted.map((id) => r.state.stack.find((e) => e.id === id).pid);
  assert.ok(!prompted.includes("C"));
  assert.deepEqual(prompted, ["B"]);
});

test("test 8: a prompted player switching to Slow starts a nested cascade; Locked skipped; guard stops runaway", () => {
  const ps = [P("A", 2), P("B", 6), P("C", 7), P("D", 8)];
  let s = setup(ps);
  s = declareAll(s, ["A", "B", "C"]);
  let r = declare(s, "D", decl({ slow: 3 })); // D at 5 -> prompts B, C
  assert.deepEqual(r.state.queue.map((q) => q.pid), ["B", "C"]);
  s = reconfirm(r.state, r.state.queue[0].entryId, null).state; // B keeps
  const cEntry = s.queue[0].entryId;
  r = reconfirm(s, cEntry, decl({ slow: 4, label: "Steady Strike" })); // C -> 3: prompts B (6); D Locked is skipped
  assert.deepEqual(r.prompted.map((id) => r.state.stack.find((e) => e.id === id).pid), ["B"]);
  assert.equal(r.state.stack.find((e) => e.id === cEntry).state, "LOCKED");
  assert.equal(r.state.queue[0].depth, 2);

  // Guard: 30 submitted participants, one Slow at the bottom prompts at most 25.
  const many = Array.from({ length: 31 }, (_, i) => P(`p${i}`, i + 1));
  let m = setup(many);
  m = declareAll(m, many.slice(0, 30).map((p) => p.id));
  const g = declare(m, "p30", decl({ slow: 40 }));
  assert.equal(g.prompted.length, CASCADE_GUARD);
});

test("test 9: Fast 3 at momentum 5 -> effective 8, no prompts, resolves above 6 and 7", () => {
  const ps = [P("X", 5), P("Y", 6), P("Z", 7)];
  let s = setup(ps);
  const r = declare(s, "X", decl({ fast: 3 }));
  assert.deepEqual(r.prompted, []);
  assert.equal(r.entry.effective, 8);
  s = declareAll(r.state, ["Y", "Z"]);
  assert.deepEqual(resolutionOrder(s).map((e) => e.pid), ["X", "Z", "Y"]);
});

test("test 10: Duelist 3 at 10 lowers 2 -> effective 8 and +2 flat; duelists act in descending order", () => {
  const ps = [P("M", 7), P("N", 10)];
  let s = setup(ps);
  s = declareAll(s, ["M", "N"], () => decl({ duelist: 3 }));
  s = beginFinalization(s).state;
  const [first, second] = s.duelistQueue.map((id) => s.stack.find((e) => e.id === id).pid);
  assert.deepEqual([first, second], ["N", "M"]);
  s = applyDuelist(s, s.duelistQueue[0], 2).state;
  const n = s.stack.find((e) => e.pid === "N");
  assert.equal(n.effective, 8);
  assert.equal(n.duelistBonus, 2);
  assert.deepEqual(applyDuelist(s, "nope", 1).errors, [{ code: "notDuelistTurn" }]);
  s = applyDuelist(s, s.duelistQueue[0], 9).state; // clamped to X
  assert.equal(s.stack.find((e) => e.pid === "M").duelistBonus, 3);
  assert.equal(s.duelistQueue.length, 0);
});

test("declaring out of turn is rejected; passing advances", () => {
  let s = setup([P("A", 1), P("B", 2)]);
  assert.deepEqual(declare(s, "B", decl()).errors, [{ code: "notYourTurn" }]);
  s = pass(s, "A").state;
  assert.equal(nextStep(s).pid, "B");
});

test("execution: top to bottom, spend at resolution, cancelled entries spend nothing, then surrender", () => {
  let s = setup([P("A", 3), P("B", 6)]);
  s = declareAll(s, ["A", "B"], (pid) => decl({ cost: pid === "A" ? 2 : 1 }));
  s = beginExecution(beginFinalization(s).state).state;
  assert.equal(currentEntry(s).pid, "B");
  let r = resolveEntry(s, currentEntry(s).id, { hit: true });
  assert.equal(r.momentumChange, -1);
  s = cancelEntry(r.state, currentEntry(r.state).id, "B").state;
  assert.equal(s.phase, "surrender");
  assert.equal(resolveEntry(s, s.stack.find((e) => e.pid === "A").id, { hit: true }).momentumChange, 0);
});

test("aid gives a lower entry buff dice when it succeeds", () => {
  let s = setup([P("A", 3), P("B", 6)]);
  s = declare(s, "A", decl()).state;
  const target = s.stack[0].id;
  s = declare(s, "B", decl({ aid: 2, rolls: false, target: { kind: "entry", entryId: target } })).state;
  s = beginExecution(beginFinalization(s).state).state;
  const r = resolveEntry(s, currentEntry(s).id, { hit: null });
  assert.equal(r.aidTo, target);
  assert.equal(r.state.stack.find((e) => e.id === target).mods.buff, 2);
});

function fullRound(s, ps, decls, results = {}) {
  s = startRound(s, ps).state;
  s = beginDeclaration(s, ps, dice(7, 13)).state;
  for (const pid of s.order) s = declare(s, pid, decls[pid] ?? decl()).state;
  s = beginExecution(beginFinalization(s).state).state;
  const changes = {};
  let e;
  while ((e = currentEntry(s))) {
    const r = resolveEntry(s, e.id, { hit: results[e.pid] ?? true });
    changes[e.pid] = r.momentumChange;
    s = r.state;
  }
  return { s: endRound(s).state, changes };
}

test("test 14: Charge resolves on the Xth consecutive declaration; missing a round resets", () => {
  const ps = [P("A", 5)];
  const charge = decl({ charge: 2, actionKey: "big" });
  let s = newEncounterState();
  let r = fullRound(s, ps, { A: charge });
  assert.equal(r.changes.A, 0); // charging: nothing spent
  assert.equal(r.s.memory.A.charge.count, 1);
  r = fullRound(r.s, ps, { A: charge });
  assert.equal(r.changes.A, -1); // resolved
  assert.equal(r.s.memory.A.charge, null);
  // missing a round resets
  r = fullRound(newEncounterState(), ps, { A: charge });
  r = fullRound(r.s, ps, { A: decl() });
  r = fullRound(r.s, ps, { A: charge });
  assert.equal(r.changes.A, 0);
  // "after" setting: resolves the round after the Xth
  let st = beginDeclaration(startRound(newEncounterState(), ps).state, ps, dice(1)).state;
  const e = declare(st, "A", decl({ charge: 1 }), dice(1), { chargeResolvesOn: "after" }).entry;
  assert.equal(e.state, "CHARGING");
});

test("test 14: Taxing X blocks another Taxing action until X full rounds pass", () => {
  const ps = [P("A", 9)];
  const taxing = decl({ taxing: 1 });
  let r = fullRound(newEncounterState(), ps, { A: taxing });
  let s = beginDeclaration(startRound(r.s, ps).state, ps).state;
  assert.equal(declare(s, "A", taxing).errors[0].code, "taxingCooldown");
  r = fullRound(r.s, ps, { A: decl() }); // round 2 passes
  r = fullRound(r.s, ps, { A: taxing }); // round 3 allowed
  assert.equal(r.changes.A, -1);
});

test("test 14: Determined X refunds X on a miss", () => {
  const ps = [P("A", 9)];
  assert.equal(fullRound(newEncounterState(), ps, { A: decl({ cost: 3, determined: 2 }) }, { A: false }).changes.A, -1);
  assert.equal(fullRound(newEncounterState(), ps, { A: decl({ cost: 3, determined: 2 }) }, { A: true }).changes.A, -3);
});

test("test 14: Inevitable failures lower everyone else's momentum for ordering, cumulative, reset on success", () => {
  const ps = [P("A", 5), P("B", 6)];
  const inev = decl({ inevitable: true, actionKey: "doom" });
  let r = fullRound(newEncounterState(), ps, { A: inev }, { A: false });
  r = fullRound(r.s, ps, { A: inev }, { A: false });
  assert.equal(r.s.memory.A.inevitable.count, 2);
  let s = beginDeclaration(startRound(r.s, ps).state, ps).state;
  assert.equal(s.roundMomentum.B, 4); // 6 - 2
  assert.equal(s.roundMomentum.A, 5);
  assert.deepEqual(s.order, ["B", "A"]);
  r = fullRound(r.s, ps, { A: inev }, { A: true });
  assert.equal(r.s.memory.A.inevitable, null);
});

test("momentum gain from round 2, capped at the ceiling, never lowering", () => {
  let s = newEncounterState();
  const ps = [{ id: "A", momentum: 7, gain: 2, ceiling: 8 }, { id: "B", momentum: 9, gain: 1, ceiling: 8 }];
  assert.deepEqual(startRound(s, ps).gains, {});
  s = startRound(s, ps).state;
  assert.deepEqual(startRound(s, ps).gains, { A: 8 });
});

test("surrender flags", () => {
  assert.deepEqual(surrenderFlags({ defeatedTracks: 1, momentum: -1, allDepleted: false }), ["defeated", "negativeMomentum"]);
  assert.deepEqual(surrenderFlags({}), []);
});

test("cascade prompts helper ignores pending, locked and charging entries", () => {
  let s = setup([P("A", 6), P("B", 7), P("C", 8)]);
  s = declare(s, "A", decl({ charge: 3 })).state; // CHARGING
  s = declare(s, "B", decl()).state;
  const r = declare(s, "C", decl({ slow: 5 }));
  assert.deepEqual(cascadePrompts(r.state, r.entry).map((e) => e.pid), ["B"]);
});
