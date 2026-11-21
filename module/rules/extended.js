/**
 * Persistent and linked encounters (§7.11). Pure JS, no Foundry imports.
 *
 *  - encounter labels (free text chips the GM adds to tell encounters apart);
 *  - room-entry momentum: what a character brings into a room from their relationships;
 *  - linked momentum: one action's momentum changes applied in several encounters at once;
 *  - momentum thresholds: which values a momentum change met, for the chat log.
 */

const MAX_LABEL = 40;

/** "court, Act 2 ,court" → ["court", "Act 2"]. Accepts text or an array; trims, drops blanks and repeats. */
export function parseLabels(input) {
  const parts = Array.isArray(input) ? input : String(input ?? "").split(",");
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const label = String(p ?? "").trim().slice(0, MAX_LABEL);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Filter encounters for a list. Each encounter: {kind, labels, closed, name}.
 * filter: {kind: "" | kind, label: "" | label, closed: bool (show closed too), text}
 */
export function filterEncounters(list, filter = {}) {
  const text = String(filter.text ?? "").trim().toLowerCase();
  const label = String(filter.label ?? "").toLowerCase();
  return list.filter((e) => {
    if (e.closed && !filter.closed) return false;
    if (filter.kind && e.kind !== filter.kind) return false;
    if (label && !(e.labels ?? []).some((l) => l.toLowerCase() === label)) return false;
    if (text && !`${e.name ?? ""} ${(e.labels ?? []).join(" ")}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

/**
 * Room entry (§7.11, OPEN #25): the starting momentum a character brings into a room is the
 * highest momentum they hold among relevant relationships, capped at their ceiling. A
 * relationship is relevant when one of its other participants is in the room. No relevant
 * relationship: the character starts at their normal starting momentum.
 *
 * @param {object} a
 * @param {number} a.starting
 * @param {number} a.ceiling
 * @param {{id?:string, momentum:number, counterparts:string[]}[]} a.relationships
 * @param {string[]} a.present   actor ids already in the room
 * @returns {{value:number, from:string|null}}  from: the relationship id used, or null
 */
export function roomEntryMomentum({ starting, ceiling, relationships = [], present = [] }) {
  const here = new Set(present);
  let best = null;
  for (const r of relationships) {
    if (!(r.counterparts ?? []).some((id) => here.has(id))) continue;
    if (!best || r.momentum > best.momentum) best = r;
  }
  if (!best) return { value: starting, from: null };
  return { value: Number.isFinite(ceiling) ? Math.min(ceiling, best.momentum) : best.momentum, from: best.id ?? null };
}

/**
 * Linked momentum. One action's momentum changes (its cost and its momentum outcomes) are
 * applied in each linked encounter, to the acting character and the target where they take part.
 * The ledger records what has been applied where, so linking an encounter after the changes
 * were applied catches it up, and nothing is applied twice.
 *
 * @param {object} a
 * @param {{key:string, who:"actor"|"target", delta?:number, set?:number}[]} a.changes  changes already applied in the action's own encounter
 * @param {{combatId:string, actorPid?:string|null, targetPid?:string|null}[]} a.encounters  linked encounters
 * @param {Record<string, boolean>} [a.ledger]  keys `${combatId}:${changeKey}` already applied
 * @returns {{combatId, pid, who, key, ledgerKey, delta?, set?}[]}
 */
export function linkedMomentumOps({ changes = [], encounters = [], ledger = {} }) {
  const ops = [];
  for (const enc of encounters) {
    for (const ch of changes) {
      const pid = ch.who === "target" ? enc.targetPid : enc.actorPid;
      if (!pid) continue;
      const ledgerKey = `${enc.combatId}:${ch.key}`;
      if (ledger[ledgerKey]) continue;
      const op = { combatId: enc.combatId, pid, who: ch.who, key: ch.key, ledgerKey };
      if (ch.set != null) op.set = ch.set;
      else op.delta = ch.delta ?? 0;
      if (op.set == null && !op.delta) continue;
      ops.push(op);
    }
  }
  return ops;
}

/**
 * The momentum changes on an action card that count for linking.
 * @param {object} a
 * @param {number} a.cost            the action's momentum cost
 * @param {boolean} a.costSpent      whether the cost was taken
 * @param {{index:number, effect:{op, to, args}}[]} a.rows   the card's relevant outcome rows
 * @param {Record<string, any>} a.applied   message applied flags by row index (true once applied)
 */
export function actionMomentumChanges({ cost = 0, costSpent = false, rows = [], applied = {} }) {
  const out = [];
  if (costSpent && cost) out.push({ key: "cost", who: "actor", delta: -cost });
  for (const r of rows) {
    if (r.effect?.op !== "momentum" || applied[r.index] !== true) continue;
    const a = r.effect.args ?? {};
    const change = { key: `row${r.index}`, who: r.effect.to === "target" ? "target" : "actor" };
    if (a.set != null) change.set = a.set;
    else change.delta = a.delta ?? 0;
    out.push(change);
  }
  return out;
}

/**
 * Momentum thresholds a change met (for the chat log). Talent thresholds come from conditional
 * effects on momentum (triggers momentumCrossed / extendedMomentum). A value v is met going up
 * when from < v ≤ to, and going down when from > v ≥ to (the same test the triggers use).
 * The rules' own lines are reported too: dropping below zero (§5.2) and reaching the ceiling (§5.1).
 *
 * @param {object} a
 * @param {number} a.from
 * @param {number} a.to
 * @param {number} [a.ceiling]
 * @param {{value:number, direction?:"any"|"up"|"down", source?:string}[]} [a.thresholds]
 * @returns {{type:"talent"|"belowZero"|"ceiling", value:number, direction:"up"|"down", source?:string}[]}
 */
export function crossedThresholds({ from, to, ceiling, thresholds = [] }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
  const dir = to > from ? "up" : "down";
  const out = [];
  const seen = new Set();
  for (const t of thresholds) {
    const v = Number(t.value ?? 0);
    const met = dir === "up" ? from < v && to >= v : from > v && to <= v;
    if (!met) continue;
    if (t.direction && t.direction !== "any" && t.direction !== dir) continue;
    const key = `${v}|${t.source ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: "talent", value: v, direction: dir, source: t.source });
  }
  if (from >= 0 && to < 0) out.push({ type: "belowZero", value: 0, direction: "down" });
  if (Number.isFinite(ceiling) && from < ceiling && to >= ceiling) out.push({ type: "ceiling", value: ceiling, direction: "up" });
  return out;
}

/**
 * Momentum thresholds from talents, as seen by one participant's change. A talent's trigger
 * scope decides whose momentum it watches: `self` its owner's, `other` / `ally` / `enemy` /
 * `targetsMe` / `targetedByMe` someone else's, `any` everyone's. Team and targeting details
 * are left to the trigger itself; the chat note only says the value was met.
 *
 * @param {{ownerId:string, talentName:string, effects:object[]}[]} talents
 * @param {string} pid      the participant whose momentum changed
 * @param {string} kind     the encounter kind
 */
export function talentThresholds(talents, pid, kind) {
  const out = [];
  for (const t of talents) {
    for (const fx of t.effects ?? []) {
      const trig = fx?.trigger ?? {};
      if (trig.event !== "momentumCrossed" && trig.event !== "extendedMomentum") continue;
      const p = trig.params ?? {};
      if (trig.event === "extendedMomentum" && (kind === "standard" || (p.kind && p.kind !== "any" && p.kind !== kind))) continue;
      const scope = trig.actor ?? "self";
      const mine = t.ownerId === pid;
      if (scope === "self" ? !mine : scope === "any" ? false : mine) continue;
      out.push({ value: Number(p.value ?? 0), direction: p.direction ?? "any", source: fx.label ? `${t.talentName}: ${fx.label}` : t.talentName });
    }
  }
  return out;
}
