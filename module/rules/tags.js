/**
 * Tags (§6.4). Pure JS, no Foundry imports.
 * A tag is { name, value }. Value 0 means "no intensity".
 */

/** Engine-aware tags. Everything else is a free label. */
export const ENGINE_TAGS = Object.freeze([
  { name: "slow", valued: true, status: "RULE", description: "Effective momentum = momentum − X. Declarer becomes Locked and triggers re-confirmation." },
  { name: "fast", valued: true, status: "RULE", description: "Effective momentum = momentum + X. No cascade." },
  { name: "reaction", valued: false, status: "DRAFT", description: "Replaces the actor's own action and acts on an entry already on the stack." },
  { name: "interruptible", valued: true, status: "DRAFT", description: "Can be disrupted; X (1–3) = how hard. Mechanic open." },
  { name: "duelist", valued: true, status: "RULE", description: "After declarations, lower effective momentum by 0–X for an equal flat bonus." },
  { name: "charge", valued: true, status: "RULE", description: "Must be declared X rounds in a row before it resolves." },
  { name: "recovery", valued: false, status: "RULE", description: "Usable at zero or negative momentum." },
  { name: "inevitable", valued: false, status: "RULE", description: "Each failed attempt makes everyone else 1 momentum lower for ordering." },
  { name: "taxing", valued: true, status: "RULE", description: "X rounds must pass before another Taxing action." },
  { name: "determined", valued: true, status: "RULE", description: "If the action does not succeed, refund X momentum." },
  { name: "offensive", valued: false, status: "RULE", description: "Target's momentum resistance is added to the cost." },
  { name: "aid", valued: true, status: "DRAFT", description: "Gives a lower stack entry X buff dice." },
  { name: "hinder", valued: true, status: "DRAFT", description: "Gives a lower stack entry X debuff dice." },
  { name: "delayed", valued: false, status: "OPEN", description: "Resolves after all non-delayed entries." },
  { name: "armor penetrating", valued: true, status: "OPEN", description: "Stored only; armor interaction undecided." },
  { name: "armor ineffective", valued: true, status: "OPEN", description: "Stored only; armor interaction undecided." },
  { name: "draw", valued: true, status: "optional", description: "Card deck: draws cards." },
  { name: "cashout", valued: false, status: "optional", description: "Card deck: uses a poker hand." },
  { name: "draining", valued: true, status: "OPEN", description: "Pending in the source. Not implemented." }
]);

/** Common label-only tags, offered for autocomplete. */
export const LABEL_TAGS = Object.freeze(["strike", "control", "magic", "two-handed", "movement"]);

export function normalizeTagName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeTag(tag) {
  return { name: normalizeTagName(tag?.name), value: Math.floor(Number(tag?.value) || 0) };
}

/** Parse "slow 2, offensive, armor penetrating 1" -> [{name, value}]. A trailing integer is the value. */
export function parseTags(text = "") {
  return String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s+(-?\d+)$/);
    return m ? normalizeTag({ name: m[1], value: Number(m[2]) }) : normalizeTag({ name: s, value: 0 });
  });
}

export function formatTags(tags = []) {
  return tags.map((t) => (t.value ? `${t.name} ${t.value}` : t.name)).join(", ");
}

/**
 * Union tag lists in order. Same-name tags merge by `mode` [OPEN #8]:
 *   sum  values add (default)
 *   max  highest value
 *   last last one wins
 */
export function mergeTags(lists, mode = "sum") {
  const out = new Map();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const t = normalizeTag(raw);
      if (!t.name) continue;
      if (!out.has(t.name)) {
        out.set(t.name, { ...t });
        continue;
      }
      const cur = out.get(t.name);
      if (mode === "max") cur.value = Math.max(cur.value, t.value);
      else if (mode === "last") cur.value = t.value;
      else cur.value += t.value;
    }
  }
  return [...out.values()];
}

export function hasTag(tags, name) {
  const n = normalizeTagName(name);
  return (tags ?? []).some((t) => normalizeTagName(t.name) === n);
}

export function tagValue(tags, name) {
  const n = normalizeTagName(name);
  return (tags ?? []).filter((t) => normalizeTagName(t.name) === n).reduce((s, t) => s + (Number(t.value) || 0), 0);
}

/** Registry = engine tags + designer tags. Designer entries cannot override engine ones. */
export function buildRegistry(custom = []) {
  const reg = new Map(ENGINE_TAGS.map((t) => [t.name, { ...t, engine: true }]));
  for (const name of LABEL_TAGS) reg.set(name, { name, valued: false, engine: false, description: "" });
  for (const t of custom) {
    const name = normalizeTagName(t?.name);
    if (!name || reg.get(name)?.engine) continue;
    reg.set(name, { name, valued: Boolean(t.valued), engine: false, description: String(t.description ?? "") });
  }
  return [...reg.values()].sort((a, b) => a.name.localeCompare(b.name));
}
