/**
 * Effects (§6.3). Pure JS, no Foundry imports.
 *
 * An effect is { trigger, op, args, to }:
 *   trigger  when it applies (EFFECT_TRIGGERS)
 *   op       what it does (EFFECT_OPS)
 *   args     op-specific arguments (described by EFFECT_OPS[op].args)
 *   to       who it lands on: self | target | room
 *
 * The catalog drives the typed editor, validation and plain-language previews.
 * Ops with `json: true` keep a raw JSON editor for their args (card deck ops).
 */

export const EFFECT_TRIGGERS = Object.freeze(["declare", "finalize", "onHit", "onMiss", "onResolve", "while"]);
export const EFFECT_TARGETS = Object.freeze(["self", "target", "room"]);

/** Arg types: int, stat, tag, text, bool, select (with options). */
export const EFFECT_OPS = Object.freeze({
  cost: { layer: "economy", args: [{ key: "delta", type: "int" }] },
  momentum: { layer: "economy", args: [{ key: "delta", type: "int" }, { key: "set", type: "int", optional: true }] },
  draw: { layer: "economy", args: [{ key: "count", type: "int" }] },
  rollStat: { layer: "resolution", args: [{ key: "stat", type: "stat" }] },
  targetStat: { layer: "resolution", args: [{ key: "stat", type: "stat" }] },
  dice: { layer: "resolution", args: [{ key: "buff", type: "int" }, { key: "debuff", type: "int" }] },
  tierShift: {
    layer: "resolution",
    args: [
      { key: "delta", type: "int" },
      { key: "stat", type: "stat", optional: true },
      { key: "appliesTo", type: "select", options: ["roll", "defense", "attackers"] }
    ]
  },
  dc: { layer: "resolution", args: [{ key: "value", type: "int", optional: true }, { key: "task", type: "bool" }] },
  flat: { layer: "resolution", args: [{ key: "value", type: "int" }] },
  addTag: { layer: "stack", args: [{ key: "name", type: "tag" }, { key: "value", type: "int" }] },
  move: { layer: "mobility", args: [{ key: "text", type: "text" }] },
  status: {
    layer: "outcomes",
    args: [
      { key: "mode", type: "select", options: ["apply", "remove"] },
      { key: "name", type: "text" },
      { key: "value", type: "int" }
    ]
  },
  pips: {
    layer: "outcomes",
    args: [{ key: "delta", type: "int" }, { key: "track", type: "select", options: ["physical", "mental", "social", "choice"] }]
  },
  restrict: {
    layer: "restrictions",
    args: [{ key: "tag", type: "tag" }, { key: "until", type: "text" }, { key: "breakRoll", type: "stat", optional: true }, { key: "breakTarget", type: "stat", optional: true }]
  },
  note: { layer: "notes", args: [{ key: "text", type: "text" }] },
  deckModify: { layer: "cards", json: true, args: [] },
  deckMark: { layer: "cards", json: true, args: [] },
  cardMark: { layer: "cards", json: true, args: [] },
  pokerHand: { layer: "cards", json: true, args: [] }
});

/** Default args for a new effect of `op`. */
export function defaultArgs(op) {
  const def = EFFECT_OPS[op];
  if (!def) return {};
  const args = {};
  for (const a of def.args) {
    if (a.optional) continue;
    if (a.type === "int") args[a.key] = 0;
    else if (a.type === "bool") args[a.key] = false;
    else if (a.type === "select") args[a.key] = a.options[0];
    else args[a.key] = "";
  }
  if (op === "dice") args.buff = 1;
  if (op === "cost" || op === "pips") args.delta = 1;
  if (op === "draw") args.count = 1;
  if (op === "tierShift") args.delta = 1;
  if (op === "pokerHand") Object.assign(args, { minRank: 1, consume: "selected" });
  return args;
}

export function newEffect(op = "note") {
  return { trigger: op === "dice" || op === "rollStat" || op === "targetStat" || op === "cost" ? "declare" : "onHit", op, args: defaultArgs(op), to: "self" };
}

/**
 * Coerce an effect's args to the catalog types (form values arrive as strings).
 * Unknown keys are kept for JSON ops and dropped for typed ops.
 */
export function coerceEffect(effect) {
  const op = effect?.op;
  const def = EFFECT_OPS[op];
  const out = {
    trigger: EFFECT_TRIGGERS.includes(effect?.trigger) ? effect.trigger : "onResolve",
    op,
    args: {},
    to: EFFECT_TARGETS.includes(effect?.to) ? effect.to : "self"
  };
  const src = effect?.args ?? {};
  if (!def || def.json) {
    out.args = typeof src === "object" && src !== null ? src : {};
    return out;
  }
  for (const a of def.args) {
    const v = src[a.key];
    if (a.optional && (v === "" || v == null)) continue;
    if (a.type === "int") out.args[a.key] = Math.trunc(Number(v) || 0);
    else if (a.type === "bool") out.args[a.key] = v === true || v === "true" || v === "on";
    else if (a.type === "select") out.args[a.key] = a.options.includes(v) ? v : a.options[0];
    else out.args[a.key] = String(v ?? "");
  }
  return out;
}

/**
 * Validate an effect. Returns error codes (i18n-friendly).
 */
export function validateEffect(effect, { isStatKey = () => true } = {}) {
  const errors = [];
  const def = EFFECT_OPS[effect?.op];
  if (!def) return [`unknownOp:${effect?.op}`];
  if (!EFFECT_TRIGGERS.includes(effect.trigger)) errors.push("badTrigger");
  if (!EFFECT_TARGETS.includes(effect.to)) errors.push("badTarget");
  for (const a of def.args) {
    const v = effect.args?.[a.key];
    if (a.optional && (v === "" || v == null)) continue;
    if (a.type === "stat" && !isStatKey(v)) errors.push(`badStat:${a.key}`);
    if (a.type === "tag" && !String(v ?? "").trim()) errors.push(`emptyTag:${a.key}`);
    if (a.type === "text" && a.key !== "until" && !String(v ?? "").trim() && effect.op !== "move") errors.push(`emptyText:${a.key}`);
  }
  if (effect.op === "dc" && effect.args?.value == null && !effect.args?.task) errors.push("dcNeedsValue");
  return errors;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;
const TRIGGER_TEXT = {
  declare: "When declared",
  finalize: "When finalized",
  onHit: "On hit",
  onMiss: "On miss",
  onResolve: "On resolution",
  while: "While active"
};

/**
 * Plain-language one-liner for designers to check the record says what they meant.
 * @param {object} effect
 * @param {{stat?: (key) => string}} [labels]
 */
export function describeEffect(effect, { stat = (k) => k } = {}) {
  const a = effect?.args ?? {};
  const who = effect?.to === "target" ? "the target" : effect?.to === "room" ? "everyone in the room" : "you";
  const whose = effect?.to === "target" ? "the target's" : effect?.to === "room" ? "the room's" : "your";
  let body;
  switch (effect?.op) {
    case "cost": body = `cost ${signed(a.delta)} momentum`; break;
    case "momentum": body = a.set != null ? `set ${whose} momentum to ${a.set}` : `${who} ${a.delta >= 0 ? "gain" : "lose"} ${Math.abs(a.delta)} momentum`; break;
    case "draw": body = `${who} draw ${plural(a.count, "card")}`; break;
    case "rollStat": body = `roll with ${stat(a.stat)}`; break;
    case "targetStat": body = `test the target's ${stat(a.stat)}`; break;
    case "dice": {
      const parts = [];
      if (a.buff) parts.push(plural(a.buff, "buff die").replace("dies", "dice"));
      if (a.debuff) parts.push(plural(a.debuff, "debuff die").replace("dies", "dice"));
      body = parts.length ? `${parts.join(" and ")} on ${whose} roll` : "no dice change";
      break;
    }
    case "tierShift": {
      const s = a.stat ? stat(a.stat) : "the rolling stat";
      const scope = a.appliesTo === "defense" ? " for defense" : a.appliesTo === "attackers" ? " for anyone attacking them" : "";
      body = `${who} ${a.delta >= 0 ? "rise" : "drop"} ${plural(Math.abs(a.delta), "tier")} in ${s}${scope}`;
      break;
    }
    case "dc": body = a.task ? "use the default task DC" : `use DC ${a.value}`; break;
    case "flat": body = `${signed(a.value)} flat to the roll`; break;
    case "addTag": body = `add tag ${a.name}${a.value ? ` ${a.value}` : ""}`; break;
    case "move": body = `movement: ${a.text}`; break;
    case "status": body = `${a.mode === "remove" ? "remove" : "apply"} ${a.name}${a.value ? ` ${a.value}` : ""} ${a.mode === "remove" ? "from" : "to"} ${who}`; break;
    case "pips": body = `${who} ${a.delta >= 0 ? "lose" : "recover"} ${plural(Math.abs(a.delta), "pip")}${a.track && a.track !== "choice" ? ` of ${a.track}` : ""}`; break;
    case "restrict": body = `${who} cannot use ${a.tag} actions${a.until ? ` until ${a.until}` : ""}${a.breakRoll ? ` (break: ${stat(a.breakRoll)} vs ${stat(a.breakTarget || a.breakRoll)})` : ""}`; break;
    case "note": body = a.text; break;
    case "deckModify": case "deckMark": case "cardMark": case "pokerHand":
      body = `card effect (${effect.op})`; break;
    default: body = `unknown effect ${effect?.op}`;
  }
  return `${TRIGGER_TEXT[effect?.trigger] ?? effect?.trigger}: ${body}.`;
}
