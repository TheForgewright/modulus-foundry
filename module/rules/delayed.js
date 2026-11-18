/**
 * Delayed effects. Pure JS, no Foundry imports.
 *
 * An outcome effect with `delay: n` is not applied when it is applied: it is scheduled in the
 * encounter state and fires at the start of round (current + n). The encounter keeps
 *   state.delayed = [{ id, dueRound, scheduledRound, effect, source, text, actorPid, targetPid, actorUuid, targetUuid }]
 */

/**
 * Schedule an effect. `effect.delay` is the number of rounds; the stored effect has no delay, so
 * applying it when due does not schedule it again.
 */
export function scheduleDelayed(state, { effect, source = "", text = "", actorPid = null, targetPid = null, actorUuid = null, targetUuid = null }) {
  const delay = Math.max(1, Math.trunc(effect?.delay ?? 1));
  const { delay: _omit, ...now } = effect;
  const s = structuredClone(state);
  s.seq = (s.seq ?? 0) + 1;
  const entry = {
    id: `d${s.round}-${s.seq}`,
    dueRound: (s.round ?? 0) + delay,
    scheduledRound: s.round ?? 0,
    effect: now,
    source,
    text,
    actorPid,
    targetPid,
    actorUuid,
    targetUuid
  };
  s.delayed = [...(s.delayed ?? []), entry];
  return { state: s, entry };
}

/** Effects due at (or before) `round`, in the order they were scheduled, and the state without them. */
export function takeDueDelayed(state, round = state.round) {
  const all = state.delayed ?? [];
  const due = all.filter((d) => d.dueRound <= round);
  if (!due.length) return { state, due: [] };
  const s = structuredClone(state);
  s.delayed = all.filter((d) => d.dueRound > round);
  return { state: s, due };
}

/** The GM cancels a pending delayed effect (dispelled, interrupted). */
export function cancelDelayed(state, id) {
  const s = structuredClone(state);
  s.delayed = (s.delayed ?? []).filter((d) => d.id !== id);
  return s;
}
