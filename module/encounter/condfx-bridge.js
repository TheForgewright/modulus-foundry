/**
 * Conditional effects in an encounter (§8.1.6). The encounter's state carries `condfx` (the active
 * instances); this module turns combat facts into what rules/condfx.js needs and back.
 * Runs on the GM client inside the encounter controller.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS } from "../rules/constants.js";
import { newCondFxState, processEvent, activeModifiers, expireEffects, consumeUsed, removeInstance, describeCondFx } from "../rules/condfx.js";
import { condFxSettings } from "../settings.js";
import { statLabel } from "../apps/item-sheet.js";

/** Each participant's talents that carry conditional effects. */
export function participantTalents(combat) {
  const out = [];
  for (const c of combat.combatants) {
    for (const item of c.actor?.items ?? []) {
      if (item.type !== "talent" || !(item.system.conditionalEffects ?? []).length) continue;
      out.push({ ownerId: c.id, talentId: item.system.talentId || item.id, talentName: item.name, effects: item.system.conditionalEffects });
    }
  }
  return out;
}

/** Matching context: participants, facts, teams, targets and stack relations. */
export function matchContext(combat, state) {
  const facts = {};
  const teams = {};
  for (const c of combat.combatants) {
    const a = c.actor;
    facts[c.id] = {
      momentum: c.momentum,
      statuses: a?.items.filter((i) => i.type === "status").map((i) => i.name) ?? [],
      pips: Object.fromEntries(DOMAINS.map((d) => [d, a?.system.tracks?.[d]?.remaining ?? 0]))
    };
    teams[c.id] = c.team;
  }
  const entryOf = (pid) => state.stack.find((e) => e.pid === pid && !e.cancelled);
  return {
    instanceId: combat.id,
    participants: combat.combatants.map((c) => c.id),
    facts,
    teams,
    disabledTriggers: condFxSettings().disabledTriggers,
    targetsOf: (pid) => {
      const t = entryOf(pid)?.decl.target;
      if (t?.kind === "actor") return [t.pid];
      if (t?.kind === "entry") return [state.stack.find((e) => e.id === t.entryId)?.pid].filter(Boolean);
      return [];
    },
    relation: (subjectId, ownerId) => {
      const a = entryOf(subjectId);
      const b = entryOf(ownerId);
      if (!a || !b) return null;
      return a.effective > b.effective ? "above" : a.effective < b.effective ? "below" : null;
    }
  };
}

/** Event target ids from a stack declaration's target. */
export function targetIdsOf(state, decl) {
  const t = decl?.target;
  if (t?.kind === "actor") return [t.pid];
  if (t?.kind === "entry") return [state.stack.find((e) => e.id === t.entryId)?.pid].filter(Boolean);
  if (t?.kind === "self") return [];
  return [];
}

/** An action event (declare or resolve) from a stack entry. */
export function actionEvent(state, entry, { timing, outcome = null }) {
  return {
    id: `${entry.id}:${timing}`,
    type: "action",
    round: state.round,
    actorId: entry.pid,
    targetIds: targetIdsOf(state, entry.decl),
    tags: entry.decl.tagList ?? [],
    words: entry.decl.words ?? [],
    rollStat: entry.decl.rollStat,
    targetStat: entry.decl.targetStat,
    timing,
    outcome
  };
}

/**
 * Process events against the encounter and return the new encounter state plus what applied.
 * Never throws for a malformed talent: it is skipped and reported in the console.
 */
export function processEvents(combat, state, events) {
  let condfx = state.condfx ?? newCondFxState();
  const applied = [];
  const talents = participantTalents(combat);
  const ctx = matchContext(combat, state);
  for (const raw of events) {
    if (!raw) continue;
    const event = { instanceId: combat.id, targetIds: [], ...raw, round: raw.round ?? state.round };
    try {
      const r = processEvent(condfx, event, talents, ctx, condFxSettings());
      condfx = r.state;
      applied.push(...r.applied);
    } catch (err) {
      console.error("Modulus | conditional effect", err);
    }
  }
  return { state: { ...state, condfx }, applied };
}

export function expire(state, at) {
  return { ...state, condfx: expireEffects(state.condfx ?? newCondFxState(), { at, round: state.round }) };
}

export function consume(state, ids) {
  return ids.length ? { ...state, condfx: consumeUsed(state.condfx ?? newCondFxState(), ids) } : state;
}

export function remove(state, id) {
  return { ...state, condfx: removeInstance(state.condfx ?? newCondFxState(), id) };
}

/** Roll-time lookups for buildDeclaration: the roller's own effects and the defender's. */
export function rollModifiers(state, pid, targetPid) {
  const condfx = state?.condfx;
  if (!condfx) return null;
  const opts = { shiftsAffectDefense: condFxSettings().shiftsAffectDefense };
  return {
    attack: (stat) => (stat ? activeModifiers(condfx, pid, stat, { mode: "attack" }) : { shifts: [], buff: 0, debuff: 0, sources: [] }),
    defense: (stat) => (stat && targetPid ? activeModifiers(condfx, targetPid, stat, { mode: "defense", ...opts }) : { shifts: [], sources: [] })
  };
}

const UNTIL = (i) => (i.until === "encounterEnd" ? "MODULUS.Talent.Until.encounter"
  : i.until === "startOfOwnerNextTurn" ? "MODULUS.Talent.Until.nextTurn"
    : i.consumeOnUse ? "MODULUS.Talent.Until.nextRoll"
      : i.expiresAfterRound === Infinity ? "MODULUS.Talent.Until.encounter" : "MODULUS.Talent.Until.round");

/** Display text for an active instance. */
export function describeInstance(i, names = {}) {
  const shifts = i.tierShifts.map((s) => `${s.delta * i.stacks > 0 ? "+" : ""}${s.delta * i.stacks} ${s.stat === "*" ? game.i18n.localize("MODULUS.Talent.AllStats") : s.stat.includes("*") ? s.stat : statLabel(s.stat)}`);
  const dice = i.dice.flatMap((d) => [d.buff ? `+${d.buff * i.stacks}▲` : null, d.debuff ? `+${d.debuff * i.stacks}▼` : null]).filter(Boolean);
  const rounds = i.expiresAfterRound !== Infinity && !i.until ? i.expiresAfterRound : null;
  return {
    id: i.id,
    talent: i.talentName,
    label: i.label || i.talentName,
    owner: names[i.ownerId] ?? i.ownerId,
    target: names[i.applyToId] ?? i.applyToId,
    text: [...shifts, ...dice].join(", "),
    until: game.i18n.format(UNTIL(i), { round: rounds }),
    stacks: i.stacks > 1 ? i.stacks : null,
    event: game.i18n.localize(`MODULUS.Talent.Trigger.${i.eventType}`)
  };
}

/** Chat note for effects that just applied. */
export async function announce(combat, applied, names) {
  if (!applied.length) return;
  const lines = applied.map((i) => {
    const d = describeInstance(i, names);
    return `<li><strong>${foundry.utils.escapeHTML(d.label)}</strong> (${foundry.utils.escapeHTML(d.owner)}): ${foundry.utils.escapeHTML(d.target)} ${foundry.utils.escapeHTML(d.text)} · ${foundry.utils.escapeHTML(d.until)}</li>`;
  }).join("");
  await ChatMessage.create({
    content: `<div class="modulus-condfx-note"><strong>${foundry.utils.escapeHTML(combat.label)}</strong><ul>${lines}</ul></div>`,
    speaker: { alias: game.i18n.localize("MODULUS.Talent.Speaker") }
  });
}

export { describeCondFx };
export const FLAG = SYSTEM_ID;
