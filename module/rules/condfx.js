/**
 * Conditional effects (§8.1). Pure JS, no Foundry imports.
 *
 * A talent's conditional effect says: when this event happens (trigger + conditions), grant these
 * tier shifts (and optionally dice) for this long. The encounter engine emits events; this module
 * matches them against the participants' talents and keeps the active instances in a small state
 * object stored with the encounter.
 *
 *   state = { instances: [], fired: { "<round>": { "<owner>|<talent>|<effect>": n } }, used: { "<round>": { "<pid>": [tagNames[]] } }, seq }
 */
import { STAT_KEYS, parseStatKey } from "./constants.js";

/* -------------------------------------------- */
/*  Catalog (§8.1.1)                             */
/* -------------------------------------------- */

/**
 * Trigger events. `action` events need these fields; others take `params` as listed.
 * `requested` marks the four the designers asked for; the rest are the suggested set (DRAFT).
 */
export const TRIGGERS = Object.freeze({
  actionUsed: { requested: true, action: true, params: [] },
  actionTargeted: { action: true, params: [] },
  actionHit: { action: true, params: [{ key: "victim", options: ["any", "self", "other"] }] },
  actionMissed: { action: true, params: [{ key: "victim", options: ["any", "self", "other"] }] },
  wordUsed: { action: true, params: [{ key: "words", type: "list" }] },
  breakPointHit: { requested: true, params: [{ key: "track", options: ["any", "physical", "mental", "social"] }] },
  sceneTrackChanged: { requested: true, params: [{ key: "to", options: ["any", "action", "drama", "intrigue"] }, { key: "from", options: ["any", "none", "action", "drama", "intrigue"] }] },
  statusApplied: { params: [{ key: "name", type: "text" }, { key: "track", options: ["any", "physical", "mental", "social", "all"] }] },
  statusRemoved: { params: [{ key: "name", type: "text" }, { key: "track", options: ["any", "physical", "mental", "social", "all"] }] },
  defeatedOnTrack: { params: [{ key: "track", options: ["any", "physical", "mental", "social"] }] },
  recoveredOnTrack: { params: [{ key: "track", options: ["any", "physical", "mental", "social"] }] },
  pipsLost: { params: [{ key: "min", type: "int" }, { key: "track", options: ["any", "physical", "mental", "social"] }] },
  momentumCrossed: { params: [{ key: "value", type: "int" }, { key: "direction", options: ["any", "up", "down"] }] },
  stackPosition: { params: [{ key: "position", options: ["top", "bottom", "directlyAbove", "directlyBelow"] }, { key: "tag", type: "text" }] },
  reconfirmed: { params: [{ key: "changed", options: ["any", "yes", "no"] }] },
  interrupted: { params: [] },
  interrupts: { params: [] },
  reactionResolved: { params: [] },
  roundStart: { params: [{ key: "round", type: "int" }, { key: "every", type: "int" }] },
  roundEnd: { params: [{ key: "round", type: "int" }, { key: "every", type: "int" }] },
  encounterStart: { params: [] },
  encounterEnd: { params: [] },
  participantJoined: { params: [] },
  participantLeft: { params: [] },
  surrendered: { params: [] },
  tierChanged: { params: [{ key: "stat", type: "stat" }] },
  extendedMomentum: { params: [{ key: "kind", options: ["any", "relationship", "investigation", "ordeal"] }, { key: "value", type: "int" }, { key: "direction", options: ["any", "up", "down"] }] },
  cardEvent: { params: [{ key: "kind", options: ["any", "cashed", "burned", "discarded"] }, { key: "minRank", type: "int" }] },
  restTaken: { params: [{ key: "kind", options: ["any", "short", "long"] }] },
  manual: { requested: false, params: [] }
});

/** Which event type each trigger listens to. */
const EVENT_TYPE = { actionUsed: "action", actionTargeted: "action", actionHit: "action", actionMissed: "action", wordUsed: "action" };

export const ACTOR_SCOPES = Object.freeze(["self", "other", "any", "targetsMe", "targetedByMe", "ally", "enemy"]);
export const APPLY_TO = Object.freeze(["self", "triggeringActor", "target", "allEncounter"]);
export const CONDITION_TYPES = Object.freeze(["momentum", "status", "pips", "round", "stat", "stackPosition", "firstUse"]);
const SCENE_TRACK = { action: "physical", drama: "social", intrigue: "mental" };

export function newCondFxState() {
  return { instances: [], fired: {}, used: {}, seq: 0 };
}

/** Fill a conditional effect record with defaults (§8.1). */
export function normalizeCondFx(def = {}, settings = {}) {
  const t = def.trigger ?? {};
  const g = def.grant ?? {};
  return {
    id: def.id || "cfx",
    label: def.label ?? "",
    trigger: {
      event: t.event ?? "",
      actor: t.actor ?? "self",
      tagsAll: (t.tagsAll ?? []).map((x) => String(x).toLowerCase()),
      tagValueMin: t.tagValueMin ?? null,
      timing: t.timing ?? "resolve",
      outcome: t.outcome ?? "any",
      params: t.params ?? {}
    },
    conditions: def.conditions ?? [],
    grant: {
      tierShifts: (g.tierShifts ?? []).map((s) => ({ stat: s.stat ?? "rollStat", delta: Math.trunc(Number(s.delta) || 0) })),
      dice: (g.dice ?? []).map((d) => ({ stat: d.stat ?? "any", buff: Math.max(0, d.buff | 0), debuff: Math.max(0, d.debuff | 0) })),
      applyTo: g.applyTo ?? "self",
      appliesToRolls: g.appliesToRolls ?? "all"
    },
    duration: { rounds: def.duration?.rounds ?? settings.defaultDuration ?? 1, until: def.duration?.until ?? null },
    stacking: def.stacking ?? "refresh",
    maxStacks: Math.max(1, def.maxStacks ?? 1),
    limitPerRound: Math.max(0, def.limitPerRound ?? settings.defaultLimitPerRound ?? 1)
  };
}

/* -------------------------------------------- */
/*  Matching (§8.1.1 - §8.1.3)                   */
/* -------------------------------------------- */

function actorInScope(scope, event, ownerId, ctx) {
  const actor = event.actorId;
  if (!actor) return true; // global events (round start, encounter start) have no acting character
  const team = (pid) => ctx.teams?.[pid] ?? "";
  switch (scope) {
    case "self": return actor === ownerId;
    case "other": return actor !== ownerId;
    case "any": return true;
    case "targetsMe": return actor !== ownerId && (event.targetIds ?? []).includes(ownerId);
    case "targetedByMe": return actor !== ownerId && (ctx.targetsOf?.(ownerId) ?? []).includes(actor);
    case "ally": return actor !== ownerId && team(actor) !== "" && team(actor) === team(ownerId);
    case "enemy": return actor !== ownerId && !(team(actor) !== "" && team(actor) === team(ownerId));
    default: return false;
  }
}

function tagsMatch(trigger, eventTags = []) {
  if (!trigger.tagsAll.length) return true;
  const values = new Map();
  for (const t of eventTags) values.set(String(t.name).toLowerCase(), (values.get(String(t.name).toLowerCase()) ?? 0) + (t.value ?? 0));
  return trigger.tagsAll.every((name) => {
    if (!values.has(name)) return false;
    const min = typeof trigger.tagValueMin === "number" ? trigger.tagValueMin : trigger.tagValueMin?.[name];
    return min == null || values.get(name) >= min;
  });
}

const any = (v) => v == null || v === "" || v === "any";

function paramsMatch(event, trigger, ownerId) {
  const p = trigger.params ?? {};
  const e = event.params ?? {};
  switch (trigger.event) {
    case "actionHit":
    case "actionMissed": {
      if (any(p.victim)) return true;
      const hitsMe = (event.targetIds ?? []).includes(ownerId);
      return p.victim === "self" ? hitsMe : !hitsMe;
    }
    case "wordUsed": {
      const words = (event.words ?? []).map((w) => String(w).toLowerCase());
      return (p.words ?? []).every((w) => words.includes(String(w).toLowerCase()));
    }
    case "breakPointHit":
    case "defeatedOnTrack":
    case "recoveredOnTrack":
      return any(p.track) || p.track === e.track;
    case "sceneTrackChanged":
      if (e.from === e.to) return false;
      return (any(p.to) || SCENE_TRACK[p.to] === e.to || p.to === e.to)
        && (any(p.from) || (p.from === "none" ? !e.from : SCENE_TRACK[p.from] === e.from || p.from === e.from));
    case "statusApplied":
    case "statusRemoved":
      return (!p.name || String(p.name).toLowerCase() === String(e.name ?? "").toLowerCase()) && (any(p.track) || p.track === e.track);
    case "pipsLost":
      return (e.amount ?? 0) >= (p.min ?? 1) && (any(p.track) || p.track === e.track);
    case "momentumCrossed":
    case "extendedMomentum": {
      if (trigger.event === "extendedMomentum" && !any(p.kind) && p.kind !== e.kind) return false;
      const v = p.value ?? 0;
      const up = e.from < v && e.to >= v;
      const down = e.from > v && e.to <= v;
      return p.direction === "up" ? up : p.direction === "down" ? down : up || down;
    }
    case "stackPosition":
      if (p.position === "top") return Boolean(e.top);
      if (p.position === "bottom") return Boolean(e.bottom);
      if (p.position === "directlyAbove") return (e.belowTags ?? []).includes(String(p.tag ?? "").toLowerCase());
      if (p.position === "directlyBelow") return (e.aboveTags ?? []).includes(String(p.tag ?? "").toLowerCase());
      return false;
    case "reconfirmed":
      return any(p.changed) || (p.changed === "yes") === Boolean(e.changed);
    case "roundStart":
    case "roundEnd":
      if (p.round && event.round !== p.round) return false;
      if (p.every && event.round % p.every !== 0) return false;
      return true;
    case "tierChanged":
      return !p.stat || p.stat === e.stat;
    case "cardEvent":
      return (any(p.kind) || p.kind === e.kind) && (p.minRank == null || (e.rank ?? -1) >= p.minRank);
    case "restTaken":
      return any(p.kind) || p.kind === e.kind;
    default:
      return true;
  }
}

/** Does `event` match the trigger of effect `def` owned by `ownerId`? (conditions not included) */
export function matchTrigger(event, def, ownerId, ctx = {}) {
  const trigger = def.trigger;
  if (!trigger.event || !TRIGGERS[trigger.event]) return false;
  if ((ctx.disabledTriggers ?? []).includes(trigger.event)) return false;
  const type = EVENT_TYPE[trigger.event] ?? trigger.event;
  if (event.type !== type) return false;
  // "Nearby" means the same encounter instance (§8.1.2).
  if (ctx.instanceId && event.instanceId && event.instanceId !== ctx.instanceId && trigger.params?.instance !== "any") return false;
  if (trigger.event === "manual") return event.params?.talentId === ctx.talentId && event.params?.effectId === def.id && event.actorId === ownerId;
  const scope = trigger.event === "actionTargeted" ? (trigger.actor === "self" ? "targetsMe" : trigger.actor) : trigger.actor;
  if (!actorInScope(scope, event, ownerId, ctx)) return false;
  if (trigger.event === "actionTargeted") {
    if (event.timing !== "declare" || !(event.targetIds ?? []).includes(ownerId)) return false;
  }
  if (type === "action") {
    if (!tagsMatch(trigger, event.tags)) return false;
    if (trigger.event === "actionHit" || trigger.event === "actionMissed") {
      if (event.timing !== "resolve" || event.outcome !== (trigger.event === "actionHit" ? "hit" : "miss")) return false;
    } else if (trigger.event === "actionUsed" || trigger.event === "wordUsed") {
      if (trigger.timing && event.timing !== trigger.timing) return false;
      if (trigger.timing === "resolve" && !any(trigger.outcome) && event.outcome !== trigger.outcome) return false;
    }
  }
  return paramsMatch(event, trigger, ownerId);
}

/**
 * AND-ed conditions (§8.1.3), evaluated at the moment of the event.
 * ctx.facts[pid] = { momentum, statuses: [names], pips: { physical: remaining, ... } }
 */
export function conditionsMet(def, event, ownerId, state, ctx = {}) {
  for (const c of def.conditions ?? []) {
    const who = c.who === "subject" ? event.actorId : ownerId;
    const f = ctx.facts?.[who] ?? {};
    switch (c.type) {
      case "momentum": {
        const m = f.momentum ?? 0;
        const v = c.value ?? 0;
        const ok = { above: m > v, below: m < v, atLeast: m >= v, atMost: m <= v }[c.op ?? "above"];
        if (!ok) return false;
        break;
      }
      case "status": {
        const hasIt = (f.statuses ?? []).some((s) => s.toLowerCase() === String(c.name ?? "").toLowerCase());
        if (hasIt !== (c.has !== false)) return false;
        break;
      }
      case "pips":
        if ((f.pips?.[c.track ?? "physical"] ?? Infinity) > (c.atMost ?? 0)) return false;
        break;
      case "round":
        if (c.exact && event.round !== c.exact) return false;
        if (c.atLeast && event.round < c.atLeast) return false;
        if (c.every && event.round % c.every !== 0) return false;
        break;
      case "stat": {
        const key = c.which === "targetStat" ? event.targetStat : event.rollStat;
        if (!key) return false;
        if (c.is?.includes(".") ? key !== c.is : parseStatKey(key).domain !== c.is) return false;
        break;
      }
      case "stackPosition": {
        const rel = ctx.relation?.(event.actorId, ownerId) ?? null; // where the subject sits relative to the owner
        if (rel !== c.relation) return false;
        break;
      }
      case "firstUse": {
        const tags = (c.tagsAll ?? []).map((x) => String(x).toLowerCase());
        const used = state.used?.[event.round]?.[ownerId] ?? [];
        if (used.some((set) => tags.every((t) => set.includes(t)))) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  Applying (§8.1.4 - §8.1.5)                   */
/* -------------------------------------------- */

function resolveStat(pattern, event) {
  if (pattern === "rollStat") return event.rollStat || "*";
  if (pattern === "targetStat") return event.targetStat || "*";
  return pattern;
}

function recipients(def, event, ownerId, ctx) {
  switch (def.grant.applyTo) {
    case "triggeringActor": return [event.actorId].filter(Boolean);
    case "target": return [...(event.targetIds ?? [])];
    case "allEncounter": return [...(ctx.participants ?? [])];
    default: return [ownerId];
  }
}

function expiryFor(def, round) {
  const until = def.duration.until;
  if (until === "encounterEnd") return { expiresAfterRound: Infinity, until, consumeOnUse: false };
  if (until === "startOfOwnerNextTurn") return { expiresAfterRound: round, until, consumeOnUse: false };
  if (until === "endOfRound") return { expiresAfterRound: round, until, consumeOnUse: false };
  const n = def.duration.rounds;
  if (n === 0) return { expiresAfterRound: Infinity, until: null, consumeOnUse: true };
  return { expiresAfterRound: round + n - 1, until: null, consumeOnUse: false };
}

/**
 * Process one event against every participant's talents.
 * @param {object} state      condfx state (not mutated)
 * @param {object} event      { id, type, round, instanceId, actorId, targetIds, tags, words, outcome, timing, rollStat, targetStat, params }
 * @param {Array<{ownerId, talentId, talentName, effects}>} talents
 * @param {object} ctx        { instanceId, participants, facts, teams, targetsOf, relation, disabledTriggers }
 * @param {object} settings   { defaultDuration, defaultLimitPerRound, chainDepth }
 * @returns {{state, applied: object[]}}  applied = instances created or refreshed (for chat / UI)
 */
export function processEvent(state, event, talents, ctx = {}, settings = {}, depth = 0) {
  const s = structuredClone(state ?? newCondFxState());
  const applied = [];
  const round = event.round ?? 0;
  const sorted = [...talents].sort((a, b) => String(a.talentId).localeCompare(String(b.talentId)) || String(a.ownerId).localeCompare(String(b.ownerId)));
  const onlyTierChanged = depth > 0;
  for (const t of sorted) {
    const defs = (t.effects ?? []).map((d) => normalizeCondFx(d, settings)).sort((a, b) => a.id.localeCompare(b.id));
    for (const def of defs) {
      if (onlyTierChanged && def.trigger.event !== "tierChanged") continue;
      const tctx = { ...ctx, talentId: t.talentId };
      if (!matchTrigger(event, def, t.ownerId, tctx)) continue;
      if (!conditionsMet(def, event, t.ownerId, s, tctx)) continue;
      const fireKey = `${t.ownerId}|${t.talentId}|${def.id}`;
      const firedThisRound = (s.fired[round] ??= {});
      if (def.limitPerRound && (firedThisRound[fireKey] ?? 0) >= def.limitPerRound) continue;
      let fired = false;
      for (const applyToId of recipients(def, event, t.ownerId, ctx)) {
        const existing = s.instances.find((i) => i.talentId === t.talentId && i.effectId === def.id && i.ownerId === t.ownerId && i.applyToId === applyToId);
        const expiry = expiryFor(def, round);
        if (existing) {
          if (def.stacking === "ignore") continue;
          Object.assign(existing, { ...expiry, round, sourceEventId: event.id });
          if (def.stacking === "stack") existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
          applied.push(existing);
          fired = true;
          continue;
        }
        const inst = {
          id: `fx${++s.seq}`,
          talentId: t.talentId,
          talentName: t.talentName ?? t.talentId,
          effectId: def.id,
          label: def.label,
          ownerId: t.ownerId,
          applyToId,
          sourceEventId: event.id,
          eventType: def.trigger.event,
          round,
          ...expiry,
          tierShifts: def.grant.tierShifts.map((x) => ({ stat: resolveStat(x.stat, event), delta: x.delta })),
          dice: def.grant.dice.map((x) => ({ ...x, stat: x.stat === "any" ? "*" : resolveStat(x.stat, event) })),
          appliesToRolls: def.grant.appliesToRolls,
          stacks: 1
        };
        s.instances.push(inst);
        applied.push(inst);
        fired = true;
      }
      if (fired) firedThisRound[fireKey] = (firedThisRound[fireKey] ?? 0) + 1;
    }
  }
  // Record tag sets used this round (for "first time" conditions), after matching this event.
  if (event.type === "action" && event.timing === "declare" && event.actorId) {
    ((s.used[round] ??= {})[event.actorId] ??= []).push((event.tags ?? []).map((x) => String(x.name).toLowerCase()));
  }
  // No chaining (§8.1.5): only effects whose trigger is tierChanged react to these, cut at chainDepth.
  const maxDepth = settings.chainDepth ?? 3;
  if (applied.some((i) => i.tierShifts.length) && depth < maxDepth) {
    const changed = [...new Set(applied.filter((i) => i.tierShifts.length).map((i) => i.applyToId))];
    for (const pid of changed) {
      for (const stat of new Set(applied.filter((i) => i.applyToId === pid).flatMap((i) => i.tierShifts.map((x) => x.stat)))) {
        const ev = { id: `${event.id}.t${depth + 1}`, type: "tierChanged", round, instanceId: event.instanceId, actorId: pid, targetIds: [], params: { stat } };
        const r = processEvent(s, ev, talents, ctx, settings, depth + 1);
        Object.assign(s, r.state);
        applied.push(...r.applied.filter((x) => !applied.includes(x)));
      }
    }
  }
  return { state: s, applied };
}

/* -------------------------------------------- */
/*  Reading at roll time (§8.1.4, §8.1.6)        */
/* -------------------------------------------- */

export function statMatches(pattern, key) {
  if (!pattern || pattern === "*") return true;
  if (pattern === key) return true;
  const [d, e] = String(pattern).split(".");
  const { domain, expression } = parseStatKey(key);
  return (d === "*" || d === domain) && (e === "*" || e === expression) && STAT_KEYS.includes(key);
}

/**
 * Active shifts and dice on `actorId` for a roll in `statKey`.
 * @param {"attack"|"defense"} mode  attack = the actor's own roll; defense = the DC lookup when targeted
 * @returns {{shifts: number[], buff: number, debuff: number, sources: object[]}}
 */
export function activeModifiers(state, actorId, statKey, { mode = "attack", shiftsAffectDefense = true } = {}) {
  const out = { shifts: [], buff: 0, debuff: 0, sources: [] };
  for (const i of state?.instances ?? []) {
    if (i.applyToId !== actorId) continue;
    if (mode === "defense" && (i.appliesToRolls === "attack" || !shiftsAffectDefense)) continue;
    if (mode === "attack" && i.appliesToRolls === "defense") continue;
    let touched = false;
    for (const s of i.tierShifts) {
      if (!statMatches(s.stat, statKey)) continue;
      out.shifts.push(s.delta * i.stacks);
      touched = true;
    }
    if (mode === "attack") {
      for (const d of i.dice) {
        if (!statMatches(d.stat, statKey)) continue;
        out.buff += d.buff * i.stacks;
        out.debuff += d.debuff * i.stacks;
        touched = touched || d.buff > 0 || d.debuff > 0;
      }
    }
    if (touched) out.sources.push(i);
  }
  return out;
}

/** Remove "only the next roll" instances that were used. */
export function consumeUsed(state, instanceIds) {
  const s = structuredClone(state);
  s.instances = s.instances.filter((i) => !(i.consumeOnUse && instanceIds.includes(i.id)));
  return s;
}

/**
 * Expiry (§8.1.5).
 *   roundEnd      drops instances whose last round is this one (default "end of round" and rounds:n)
 *   roundStart    drops "until the start of the owner's next turn" instances from earlier rounds
 *   encounterEnd  drops everything
 */
export function expireEffects(state, { at, round }) {
  const s = structuredClone(state ?? newCondFxState());
  if (at === "encounterEnd") {
    s.instances = [];
  } else if (at === "roundEnd") {
    s.instances = s.instances.filter((i) => i.consumeOnUse || i.until === "startOfOwnerNextTurn" || i.expiresAfterRound > round);
    for (const r of Object.keys(s.fired)) if (Number(r) < round) delete s.fired[r];
    for (const r of Object.keys(s.used)) if (Number(r) < round) delete s.used[r];
  } else if (at === "roundStart") {
    s.instances = s.instances.filter((i) => i.until !== "startOfOwnerNextTurn" || i.round >= round);
  }
  return s;
}

export function removeInstance(state, id) {
  const s = structuredClone(state);
  s.instances = s.instances.filter((i) => i.id !== id);
  return s;
}

/* -------------------------------------------- */
/*  Emitter helpers                              */
/* -------------------------------------------- */

/** One breakPointHit event per break point reached, never per pip afterwards (test 17). */
export function breakPointEvents({ before, after, perLevel, actorId, track, round, instanceId }) {
  const crossed = Math.max(0, Math.floor(after / perLevel) - Math.floor(before / perLevel));
  return Array.from({ length: crossed }, (_, i) => ({ id: `bp-${actorId}-${track}-${round}-${after}-${i}`, type: "breakPointHit", round, instanceId, actorId, targetIds: [], params: { track } }));
}

/** A sceneTrackChanged event, or null when the track did not change. The first choice is from "" (none). */
export function sceneTrackEvent({ from = "", to, actorId, round, instanceId }) {
  if (!to || from === to) return null;
  return { id: `st-${actorId}-${round}-${to}`, type: "sceneTrackChanged", round, instanceId, actorId, targetIds: [], params: { from, to } };
}

/* -------------------------------------------- */
/*  Editor support (§8.1.7)                      */
/* -------------------------------------------- */

const ACTOR_TEXT = {
  self: "you", other: "another character", any: "anyone", targetsMe: "another character targeting you",
  targetedByMe: "a character you are targeting", ally: "an ally", enemy: "an enemy"
};
const TRACK_WORD = { physical: "physical", mental: "mental", social: "social" };

function statText(pattern, stat) {
  if (pattern === "rollStat") return "the rolling stat";
  if (pattern === "targetStat") return "the target stat";
  if (pattern === "*" || pattern === "any") return "every stat";
  const [d, e] = String(pattern).split(".");
  if (d === "*") return `every ${e} stat`;
  if (e === "*") return `every ${d} stat`;
  return stat(pattern);
}

/** "When another character resolves a hit with strike + offensive, you gain +1 tier in Physical Finesse until the end of the round." */
export function describeCondFx(raw, { stat = (k) => k } = {}) {
  const d = normalizeCondFx(raw);
  const t = d.trigger;
  const who = ACTOR_TEXT[t.actor] ?? t.actor;
  const tags = t.tagsAll.length ? ` with ${t.tagsAll.join(" + ")}` : "";
  const p = t.params ?? {};
  const verbs = (s) => (t.actor === "self" ? s.self : s.other);
  let when;
  switch (t.event) {
    case "actionUsed":
      if (t.timing === "declare") when = `${who} ${verbs({ self: "declare", other: "declares" })} an action${tags}`;
      else when = `${who} ${verbs({ self: "resolve", other: "resolves" })} ${t.outcome === "hit" ? "a hit" : t.outcome === "miss" ? "a miss" : "an action"}${tags}`;
      break;
    case "actionTargeted": when = `${t.actor === "self" || t.actor === "targetsMe" ? "another character" : who} declares an action${tags} targeting you`; break;
    case "actionHit": when = `${who} ${verbs({ self: "hit", other: "hits" })}${p.victim === "self" ? " you" : p.victim === "other" ? " someone else" : ""}${tags}`; break;
    case "actionMissed": when = `${who} ${verbs({ self: "miss", other: "misses" })}${p.victim === "self" ? " you" : ""}${tags}`; break;
    case "wordUsed": when = `${who} ${verbs({ self: "use", other: "uses" })} ${(p.words ?? []).join(" + ") || "a word"}`; break;
    case "breakPointHit": when = `${who} ${verbs({ self: "reach", other: "reaches" })} a ${any(p.track) ? "" : `${TRACK_WORD[p.track]} `}break point`; break;
    case "sceneTrackChanged": when = `${who} ${verbs({ self: "change", other: "changes" })} scene track${any(p.to) ? "" : ` to ${p.to}`}`; break;
    case "statusApplied": when = `${who} ${verbs({ self: "gain", other: "gains" })} ${p.name || "a status"}`; break;
    case "statusRemoved": when = `${who} ${verbs({ self: "lose", other: "loses" })} ${p.name || "a status"}`; break;
    case "defeatedOnTrack": when = `${who} ${verbs({ self: "are", other: "is" })} defeated${any(p.track) ? "" : ` on the ${p.track} track`}`; break;
    case "recoveredOnTrack": when = `${who} ${verbs({ self: "recover", other: "recovers" })}${any(p.track) ? "" : ` on the ${p.track} track`}`; break;
    case "pipsLost": when = `${who} ${verbs({ self: "lose", other: "loses" })} ${p.min ?? 1}+ pips at once`; break;
    case "momentumCrossed": when = `${who === "you" ? "your" : `${who}'s`} momentum ${p.direction === "down" ? "drops to" : p.direction === "up" ? "rises to" : "crosses"} ${p.value ?? 0}`; break;
    case "roundStart": when = `a round starts${p.round ? ` (round ${p.round})` : ""}${p.every ? ` (every ${p.every} rounds)` : ""}`; break;
    case "roundEnd": when = `a round ends`; break;
    case "manual": when = "you press the talent's button"; break;
    default: when = `${t.event || "(no trigger)"} happens`;
  }
  const grants = d.grant.tierShifts.map((s) => `${s.delta >= 0 ? `+${s.delta}` : s.delta} tier${Math.abs(s.delta) === 1 ? "" : "s"} in ${statText(s.stat, stat)}`);
  for (const x of d.grant.dice) {
    if (x.buff) grants.push(`${x.buff} buff ${x.buff === 1 ? "die" : "dice"}`);
    if (x.debuff) grants.push(`${x.debuff} debuff ${x.debuff === 1 ? "die" : "dice"}`);
  }
  const target = { self: "you gain", triggeringActor: "they gain", target: "the target gains", allEncounter: "everyone in the encounter gains" }[d.grant.applyTo] ?? "you gain";
  const scope = d.grant.appliesToRolls === "attack" ? " (own rolls only)" : d.grant.appliesToRolls === "defense" ? " (defense only)" : "";
  const until = d.duration.until === "encounterEnd" ? "until the encounter ends"
    : d.duration.until === "startOfOwnerNextTurn" ? "until the start of your next turn"
      : d.duration.rounds === 0 ? "for the next roll"
        : d.duration.rounds === 1 ? "until the end of the round" : `for ${d.duration.rounds} rounds`;
  const conds = (d.conditions ?? []).length ? `, if ${d.conditions.length} condition${d.conditions.length === 1 ? "" : "s"} hold` : "";
  return `When ${when}${conds}, ${target} ${grants.join(" and ") || "nothing"}${scope} ${until}.`;
}

/** Problems an editor should show (§8.1.4 gating check). */
export function validateCondFx(raw) {
  const d = normalizeCondFx(raw);
  const errors = [];
  const warnings = [];
  if (!d.trigger.event) errors.push("noTrigger");
  else if (!TRIGGERS[d.trigger.event]) errors.push("unknownTrigger");
  if (!d.grant.tierShifts.length && !d.grant.dice.length) errors.push("emptyGrant");
  if (d.trigger.event === "actionUsed" && d.trigger.timing === "declare" && !any(d.trigger.outcome)) errors.push("outcomeNeedsResolve");
  for (const s of d.grant.tierShifts) {
    if (!["rollStat", "targetStat", "*"].includes(s.stat) && !/^(physical|mental|social|\*)\.(power|finesse|resilience|\*)$/.test(s.stat)) errors.push("badStat");
    if (!s.delta) warnings.push("zeroDelta");
  }
  const alwaysTrue = ["roundStart", "roundEnd", "encounterStart"].includes(d.trigger.event)
    && !(d.conditions ?? []).length && !d.trigger.params?.round && !d.trigger.params?.every && d.grant.applyTo === "self";
  if (alwaysTrue) warnings.push("passiveBonus");
  return { errors, warnings };
}
