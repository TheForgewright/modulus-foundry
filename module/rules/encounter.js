/**
 * Encounter engine (§7, §14). Pure JS, no Foundry imports.
 *
 * One encounter instance = participants + per-participant momentum + one stack + a round
 * counter. Every transition here is a pure function `(state, ...) -> { state, ... }`; the
 * Foundry layer persists the state, talks to players and rolls dice.
 *
 * Phases: idle -> participation -> declaring (with re-confirm prompts) -> finalization
 *         -> executing -> surrender -> idle (next round)
 *
 * Ordering vocabulary:
 *   "declaration order"  ascending momentum; the slowest declares first (§7.3)
 *   "resolution order"   descending effective momentum; top of the stack resolves first
 *   "above X"            resolves before X: higher effective momentum, or equal and winning the tiebreak
 */

export const PHASES = Object.freeze(["idle", "participation", "declaring", "finalization", "executing", "surrender"]);
export const ENTRY_STATES = Object.freeze(["PENDING", "SUBMITTED", "LOCKED", "CHARGING"]);
export const CASCADE_GUARD = 25;

const d20 = (rng) => 1 + Math.floor(rng() * 20);

function clone(state) {
  return structuredClone(state);
}

export function newEncounterState() {
  return {
    version: 1,
    round: 0,
    phase: "idle",
    seq: 0,
    roundMomentum: {},   // pid -> momentum read at the start of declaration
    names: {},           // pid -> display name
    rolls: {},           // pid -> tiebreak d20 for this round
    order: [],           // declaration order (pids)
    cursor: 0,           // index into order of the next declarer
    stack: [],           // entries
    queue: [],           // pending re-confirm prompts: { entryId, causeEntryId, depth }
    cascadeCount: 0,     // prompts issued in the current cascade (loop guard)
    duelistQueue: [],    // entry ids awaiting a Duelist decision
    execOrder: [],       // entry ids in resolution order
    execCursor: 0,
    memory: {},          // pid -> { charge, taxing, inevitable }
    log: []
  };
}

function memoryOf(state, pid) {
  return (state.memory[pid] ??= { charge: null, taxing: 0, inevitable: null });
}

function log(state, type, data = {}) {
  state.log.push({ round: state.round, type, ...data });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

/* -------------------------------------------- */
/*  Ties and ordering                            */
/* -------------------------------------------- */

/**
 * Make sure every group of tied values has distinct tiebreak rolls (§7.3: each tied
 * participant rolls 1d20, re-rolling on equal results). Existing rolls are kept unless
 * they collide inside a tie group, in which case the colliding members re-roll.
 * @param {Record<string, number>} values  pid -> value being compared
 * @returns {Array<{pids: string[], rolls: Record<string, number>}>} rolloffs performed
 */
export function settleTies(state, values, rng) {
  const groups = new Map();
  for (const [pid, v] of Object.entries(values)) {
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(pid);
  }
  const rolloffs = [];
  for (const pids of groups.values()) {
    if (pids.length < 2) continue;
    let changed = false;
    for (const pid of pids) {
      if (state.rolls[pid] == null) {
        state.rolls[pid] = d20(rng);
        changed = true;
      }
    }
    for (let guard = 0; guard < 100; guard++) {
      const seen = new Map();
      for (const pid of pids) seen.set(state.rolls[pid], [...(seen.get(state.rolls[pid]) ?? []), pid]);
      const dupes = [...seen.values()].filter((g) => g.length > 1).flat();
      if (!dupes.length) break;
      for (const pid of dupes) state.rolls[pid] = d20(rng);
      changed = true;
    }
    if (changed) rolloffs.push({ pids: [...pids], rolls: Object.fromEntries(pids.map((p) => [p, state.rolls[p]])) });
  }
  return rolloffs;
}

/** Positive if entry a resolves before entry b. */
export function compareResolution(state, a, b) {
  if (Boolean(a.delayed) !== Boolean(b.delayed)) return a.delayed ? -1 : 1; // §6.4 delayed resolves last [OPEN]
  return (a.effective - b.effective) || ((state.rolls[a.pid] ?? 0) - (state.rolls[b.pid] ?? 0));
}

/** Is entry a above entry b (resolves earlier)? Ignores `delayed` (insertion uses effective momentum). */
export function isAbove(state, a, b) {
  return a.effective > b.effective || (a.effective === b.effective && (state.rolls[a.pid] ?? 0) > (state.rolls[b.pid] ?? 0));
}

/** Live entries sorted top (resolves first) to bottom. */
export function resolutionOrder(state) {
  return state.stack.filter((e) => !e.cancelled).sort((a, b) => compareResolution(state, b, a));
}

function settleEntryTies(state, rng) {
  return settleTies(state, Object.fromEntries(state.stack.filter((e) => !e.cancelled).map((e) => [e.pid, e.effective])), rng);
}

/** Momentum penalty for ordering from other participants' Inevitable attempts (§6.4). */
function inevitablePenalty(state, pid, pids) {
  return pids.filter((p) => p !== pid).reduce((n, p) => n + (state.memory[p]?.inevitable?.count ?? 0), 0);
}

/* -------------------------------------------- */
/*  Round flow                                   */
/* -------------------------------------------- */

/**
 * Round start (§7.3 step 1). Returns the momentum gains to apply from round 2 on (§5.2):
 * current = min(ceiling, current + gain); a value already above the ceiling is not lowered.
 * @param {Array<{id, momentum, gain, ceiling}>} participants
 */
export function startRound(state, participants = []) {
  const s = clone(state);
  s.round += 1;
  s.phase = "participation";
  s.stack = [];
  s.queue = [];
  s.duelistQueue = [];
  s.execOrder = [];
  s.execCursor = 0;
  s.order = [];
  s.cursor = 0;
  s.rolls = {};
  s.roundMomentum = {};
  const gains = {};
  if (s.round > 1) {
    for (const p of participants) {
      const next = p.momentum >= p.ceiling ? p.momentum : Math.min(p.ceiling, p.momentum + (p.gain ?? 0));
      if (next !== p.momentum) gains[p.id] = next;
    }
  }
  log(s, "roundStart");
  return { state: s, gains };
}

/**
 * Close participation and fix declaration order (§7.3 steps 2-3).
 * @param {Array<{id, name, momentum}>} participants  the ones taking part this round
 */
export function beginDeclaration(state, participants, rng = Math.random) {
  const s = clone(state);
  const pids = participants.map((p) => p.id);
  for (const p of participants) {
    s.names[p.id] = p.name;
    s.roundMomentum[p.id] = Math.trunc(p.momentum) - inevitablePenalty(s, p.id, pids);
  }
  const rolloffs = settleTies(s, s.roundMomentum, rng);
  s.order = [...pids].sort((a, b) => (s.roundMomentum[a] - s.roundMomentum[b]) || (s.rolls[a] - s.rolls[b]));
  s.cursor = 0;
  s.phase = "declaring";
  log(s, "order", { order: s.order });
  return { state: s, rolloffs };
}

/** Who acts next: a pending re-confirm, the next declarer, or nothing (declaration complete). */
export function nextStep(state) {
  if (state.phase !== "declaring") return null;
  if (state.queue.length) return { type: "reconfirm", ...state.queue[0] };
  if (state.cursor < state.order.length) return { type: "declare", pid: state.order[state.cursor] };
  return { type: "done" };
}

/* -------------------------------------------- */
/*  Declaration                                  */
/* -------------------------------------------- */

/**
 * A declaration, as summarised by the assembly engine:
 * {
 *   label, actionKey,                 display label; identity of action+words (for Charge / Inevitable)
 *   cost,                             total momentum cost
 *   slow, fast,                       tag values
 *   charge, taxing, determined, duelist, aid, hinder,   tag values (0 = absent)
 *   inevitable, delayed, reaction, recovery,            booleans
 *   rolls,                            does it roll
 *   target: { kind: "actor"|"entry"|"self"|"none", pid?, entryId? },
 *   payload                           opaque data for the Foundry layer (uuids etc.)
 * }
 */
export function validateDeclaration(state, pid, decl) {
  const errors = [];
  const mem = state.memory[pid];
  if (decl.taxing && (mem?.taxing ?? 0) > 0) errors.push({ code: "taxingCooldown", rounds: mem.taxing });
  if (decl.target?.kind === "entry") {
    const target = state.stack.find((e) => e.id === decl.target.entryId && !e.cancelled);
    if (!target) errors.push({ code: "noSuchEntry" });
    else if (target.pid === pid) errors.push({ code: "ownEntry" });
  }
  return errors;
}

function chargeProgress(state, pid, decl) {
  const mem = memoryOf(state, pid);
  if (!decl.charge) return { count: 0, due: true };
  const continuing = mem.charge && mem.charge.key === decl.actionKey && mem.charge.lastRound === state.round - 1;
  const count = continuing ? mem.charge.count + 1 : 1;
  return { count, due: count >= decl.charge };
}

function buildEntry(state, pid, decl, settings = {}) {
  const momentum = state.roundMomentum[pid] ?? 0;
  const charge = chargeProgress(state, pid, decl);
  const due = settings.chargeResolvesOn === "after" ? (decl.charge ? charge.count > decl.charge : true) : charge.due;
  return {
    id: `e${state.round}-${++state.seq}`,
    pid,
    name: state.names[pid] ?? pid,
    momentum,
    slow: decl.slow ?? 0,
    fast: decl.fast ?? 0,
    effective: momentum - (decl.slow ?? 0) + (decl.fast ?? 0),
    duelistBonus: 0,
    state: decl.charge && !due ? "CHARGING" : decl.slow ? "LOCKED" : "SUBMITTED",
    chargeCount: charge.count,
    delayed: Boolean(decl.delayed),
    decl,
    mods: { buff: 0, debuff: 0 },
    cancelled: false,
    resolved: false
  };
}

/**
 * Entries that must re-confirm after an insertion at `inserted` (§7.4): already submitted,
 * not Locked (or Charging), and now above the insertion point. Ascending order.
 */
export function cascadePrompts(state, inserted) {
  return state.stack
    .filter((e) => e.id !== inserted.id && !e.cancelled && e.state === "SUBMITTED" && isAbove(state, e, inserted))
    .sort((a, b) => compareResolution(state, a, b));
}

function runCascade(state, inserted, depth, settings) {
  const cap = settings.cascadeDepthCap > 0 ? settings.cascadeDepthCap : Infinity;
  if (depth > cap) {
    log(state, "cascadeCapped", { entryId: inserted.id, depth });
    return [];
  }
  const prompts = cascadePrompts(state, inserted).filter((e) => !state.queue.some((q) => q.entryId === e.id));
  const room = CASCADE_GUARD - state.cascadeCount;
  const issued = prompts.slice(0, Math.max(0, room));
  if (issued.length < prompts.length) log(state, "cascadeGuard", { entryId: inserted.id });
  state.cascadeCount += issued.length;
  // Nested cascades are handled before the rest of the outer queue (§7.4 recursion).
  state.queue.unshift(...issued.map((e) => ({ entryId: e.id, pid: e.pid, causeEntryId: inserted.id, causePid: inserted.pid, depth })));
  return issued.map((e) => e.id);
}

/**
 * Declare for the participant whose turn it is (§7.3 step 4). A Slow declaration Locks the
 * entry and queues re-confirmation prompts; Fast inserts higher with no cascade.
 * @returns {{state, entry, prompted: string[], errors}}
 */
export function declare(state, pid, decl, rng = Math.random, settings = {}) {
  const step = nextStep(state);
  if (!step || step.type !== "declare" || step.pid !== pid) return { state, entry: null, prompted: [], errors: [{ code: "notYourTurn" }] };
  const errors = validateDeclaration(state, pid, decl);
  if (errors.length) return { state, entry: null, prompted: [], errors };
  const s = clone(state);
  const entry = buildEntry(s, pid, decl, settings);
  s.stack.push(entry);
  settleEntryTies(s, rng);
  s.cursor += 1;
  s.cascadeCount = 0;
  const prompted = decl.slow ? runCascade(s, entry, 1, settings) : [];
  log(s, "declare", { entryId: entry.id, pid, label: decl.label, prompted });
  return { state: s, entry, prompted, errors: [] };
}

/** The participant passes (declares nothing this round). */
export function pass(state, pid) {
  const step = nextStep(state);
  if (!step || step.type !== "declare" || step.pid !== pid) return { state, errors: [{ code: "notYourTurn" }] };
  const s = clone(state);
  s.cursor += 1;
  log(s, "pass", { pid });
  return { state: s, errors: [] };
}

/**
 * Answer a re-confirm prompt. `decl` null keeps the entry as it is; otherwise it replaces
 * the declaration. A replacement with Slow Locks it and runs a nested cascade from its new
 * insertion point (Locked entries are never prompted).
 */
export function reconfirm(state, entryId, decl = null, rng = Math.random, settings = {}) {
  const s = clone(state);
  const qi = s.queue.findIndex((q) => q.entryId === entryId);
  if (qi < 0) return { state, prompted: [], errors: [{ code: "notPrompted" }] };
  const [item] = s.queue.splice(qi, 1);
  const entry = s.stack.find((e) => e.id === entryId);
  if (!decl) {
    log(s, "reconfirmKeep", { entryId });
    return { state: s, prompted: [], errors: [] };
  }
  const errors = validateDeclaration(s, entry.pid, decl);
  if (errors.length) {
    s.queue.splice(qi, 0, item);
    return { state, prompted: [], errors };
  }
  const fresh = buildEntry(s, entry.pid, decl, settings);
  Object.assign(entry, { ...fresh, id: entry.id });
  settleEntryTies(s, rng);
  const prompted = decl.slow ? runCascade(s, entry, item.depth + 1, settings) : [];
  log(s, "reconfirmChange", { entryId, label: decl.label, prompted });
  return { state: s, prompted, errors: [] };
}

/** GM override: confirm a prompt without asking (keeps the entry). */
export function forceConfirm(state, entryId) {
  return reconfirm(state, entryId, null);
}

/* -------------------------------------------- */
/*  Finalization: Duelist (§7.5)                 */
/* -------------------------------------------- */

export function beginFinalization(state) {
  const s = clone(state);
  s.phase = "finalization";
  s.duelistQueue = resolutionOrder(s)
    .filter((e) => (e.decl.duelist ?? 0) > 0 && e.state !== "CHARGING")
    .map((e) => e.id);
  log(s, "finalization", { duelists: s.duelistQueue });
  return { state: s };
}

/** Lower an entry's effective momentum by 0..X for an equal flat bonus to its roll. */
export function applyDuelist(state, entryId, drop) {
  const s = clone(state);
  const entry = s.stack.find((e) => e.id === entryId);
  if (!entry || s.duelistQueue[0] !== entryId) return { state, errors: [{ code: "notDuelistTurn" }] };
  const x = entry.decl.duelist ?? 0;
  const d = Math.max(0, Math.min(x, Math.trunc(Number(drop) || 0)));
  entry.effective -= d;
  entry.duelistBonus = d;
  s.duelistQueue.shift();
  log(s, "duelist", { entryId, drop: d });
  return { state: s, errors: [] };
}

/* -------------------------------------------- */
/*  Execution (§7.8)                             */
/* -------------------------------------------- */

export function beginExecution(state, rng = Math.random) {
  const s = clone(state);
  settleEntryTies(s, rng);
  s.phase = "executing";
  s.execOrder = resolutionOrder(s).map((e) => e.id);
  s.execCursor = 0;
  log(s, "execution", { order: s.execOrder });
  return { state: s };
}

export function currentEntry(state) {
  if (state.phase !== "executing") return null;
  for (let i = state.execCursor; i < state.execOrder.length; i++) {
    const e = state.stack.find((x) => x.id === state.execOrder[i]);
    if (e && !e.cancelled && !e.resolved) return e;
  }
  return null;
}

/**
 * Resolve an entry (§7.8) and do the tag bookkeeping.
 * @param {{hit: boolean|null}} result  null for actions that do not roll
 * @returns {{state, momentumChange: number, skipped: boolean, aidTo: string|null}}
 *   `momentumChange` is what to apply to the actor's encounter momentum: -cost, plus a
 *   Determined refund on a miss. Cancelled and still-charging entries spend nothing.
 */
export function resolveEntry(state, entryId, { hit = null } = {}) {
  const s = clone(state);
  const entry = s.stack.find((e) => e.id === entryId);
  if (!entry) return { state, momentumChange: 0, skipped: true, aidTo: null };
  advanceCursor(s, entryId);
  const mem = memoryOf(s, entry.pid);
  const d = entry.decl;
  if (entry.cancelled) return { state: s, momentumChange: 0, skipped: true, aidTo: null };
  if (entry.state === "CHARGING") {
    entry.resolved = true;
    entry.outcome = "charging";
    mem.charge = { key: d.actionKey, count: entry.chargeCount, lastRound: s.round, payload: d.payload ?? null, label: d.label };
    log(s, "charging", { entryId, count: entry.chargeCount, of: d.charge });
    finishIfDone(s);
    return { state: s, momentumChange: 0, skipped: true, aidTo: null };
  }
  entry.resolved = true;
  entry.outcome = hit === null ? "resolved" : hit ? "hit" : "miss";
  let change = -(d.cost ?? 0);
  if (d.determined && hit === false) change += d.determined;
  if (d.taxing) mem.taxing = d.taxing + 1; // X full rounds must pass (decremented at each round end)
  if (d.inevitable) {
    mem.inevitable = hit === false
      ? { key: d.actionKey, count: (mem.inevitable?.key === d.actionKey ? mem.inevitable.count : 0) + 1 }
      : null;
  } else if (mem.inevitable) mem.inevitable = null; // taking another action ends the streak
  mem.charge = null;
  let aidTo = null;
  const targetEntry = d.target?.kind === "entry" ? s.stack.find((e) => e.id === d.target.entryId) : null;
  if (targetEntry && hit !== false && (d.aid || d.hinder) && !targetEntry.resolved) {
    targetEntry.mods.buff += d.aid ?? 0;
    targetEntry.mods.debuff += d.hinder ?? 0;
    aidTo = targetEntry.id;
  }
  log(s, "resolve", { entryId, outcome: entry.outcome, momentumChange: change });
  finishIfDone(s);
  return { state: s, momentumChange: change, skipped: false, aidTo };
}

function advanceCursor(s, entryId) {
  const i = s.execOrder.indexOf(entryId);
  if (i >= s.execCursor) s.execCursor = i + 1;
}

function finishIfDone(s) {
  if (!currentEntry(s)) s.phase = "surrender";
}

/** Interrupt / cancel (§7.6, GM-adjudicated). The entry spends nothing. */
export function cancelEntry(state, entryId, byPid = null) {
  const s = clone(state);
  const entry = s.stack.find((e) => e.id === entryId);
  if (!entry || entry.resolved) return { state };
  entry.cancelled = true;
  entry.interruptedBy = byPid;
  s.queue = s.queue.filter((q) => q.entryId !== entryId);
  s.duelistQueue = s.duelistQueue.filter((id) => id !== entryId);
  log(s, "cancel", { entryId, by: byPid });
  if (s.phase === "executing") finishIfDone(s);
  return { state: s };
}

/* -------------------------------------------- */
/*  Surrender check and round end                */
/* -------------------------------------------- */

/** §7.9: flags only; the GM decides. */
export function surrenderFlags({ defeatedTracks = 0, momentum = 0, allDepleted = false }) {
  const flags = [];
  if (defeatedTracks > 0) flags.push("defeated");
  if (momentum < 0) flags.push("negativeMomentum");
  if (allDepleted) flags.push("allDepleted");
  return flags;
}

/**
 * Round reset (§7.3 step 8): clear entries, tick Taxing cooldowns, keep Charge counters.
 * A participant who did not keep charging loses their counter.
 */
export function endRound(state) {
  const s = clone(state);
  for (const [pid, mem] of Object.entries(s.memory)) {
    if (mem.taxing > 0) mem.taxing -= 1;
    if (mem.charge && mem.charge.lastRound !== s.round) mem.charge = null;
    void pid;
  }
  s.stack = [];
  s.queue = [];
  s.duelistQueue = [];
  s.execOrder = [];
  s.execCursor = 0;
  s.phase = "idle";
  log(s, "roundEnd");
  return { state: s };
}
