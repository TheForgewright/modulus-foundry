/**
 * Form model for the talent's conditional-effects editor (§8.1.7): turns records into field
 * descriptors the template renders generically, and rebuilds records from the submitted form.
 */
import { STAT_KEYS } from "../rules/constants.js";
import { TRIGGERS, ACTOR_SCOPES, APPLY_TO, CONDITION_TYPES, normalizeCondFx, describeCondFx, validateCondFx } from "../rules/condfx.js";
import { statLabel } from "../apps/item-sheet.js";

const t = (k) => game.i18n.localize(k);
const opts = (keys, prefix) => Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));
const ACTION_TRIGGERS = Object.entries(TRIGGERS).filter(([, d]) => d.action).map(([k]) => k);

export function shiftStatOptions() {
  return {
    rollStat: t("MODULUS.Talent.Stat.rollStat"),
    targetStat: t("MODULUS.Talent.Stat.targetStat"),
    "*": t("MODULUS.Talent.AllStats"),
    "physical.*": `${t("MODULUS.Domain.physical")} *`, "mental.*": `${t("MODULUS.Domain.mental")} *`, "social.*": `${t("MODULUS.Domain.social")} *`,
    "*.power": `* ${t("MODULUS.Expression.power")}`, "*.finesse": `* ${t("MODULUS.Expression.finesse")}`, "*.resilience": `* ${t("MODULUS.Expression.resilience")}`,
    ...Object.fromEntries(STAT_KEYS.map((k) => [k, statLabel(k)]))
  };
}

const CONDITION_FIELDS = {
  momentum: [["who", ["owner", "subject"]], ["op", ["above", "below", "atLeast", "atMost"]], ["value", "int"]],
  status: [["who", ["owner", "subject"]], ["has", "bool"], ["name", "text"]],
  pips: [["who", ["owner", "subject"]], ["track", ["physical", "mental", "social"]], ["atMost", "int"]],
  round: [["exact", "int"], ["atLeast", "int"], ["every", "int"]],
  stat: [["which", ["rollStat", "targetStat"]], ["is", "statOrDomain"]],
  stackPosition: [["relation", ["above", "below"]]],
  firstUse: [["tagsAll", "list"]]
};

function field(name, label, type, value, options = null) {
  return { name, label, value: value ?? "", isSelect: Array.isArray(type) || type === "select" || !!options, isInt: type === "int", isBool: type === "bool", isText: type === "text" || type === "list", options };
}

function optionField(base, key, spec, value) {
  const label = t(`MODULUS.Talent.Field.${key}`);
  if (Array.isArray(spec)) return field(`${base}.${key}`, label, "select", value, opts(spec, "MODULUS.Talent.Option"));
  if (spec === "statOrDomain") {
    return field(`${base}.${key}`, label, "select", value, {
      physical: t("MODULUS.Domain.physical"), mental: t("MODULUS.Domain.mental"), social: t("MODULUS.Domain.social"),
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, statLabel(k)]))
    });
  }
  if (spec === "stat") return field(`${base}.${key}`, label, "select", value, { "": "—", ...Object.fromEntries(STAT_KEYS.map((k) => [k, statLabel(k)])) });
  if (spec === "list") return field(`${base}.${key}`, label, "list", Array.isArray(value) ? value.join(", ") : value);
  return field(`${base}.${key}`, label, spec, value);
}

/** Field descriptors for each conditional effect row. */
export function editorRows(records) {
  return (records ?? []).map((raw, index) => {
    const d = normalizeCondFx(raw);
    const base = `_cfx.${index}`;
    const trig = d.trigger;
    const isAction = ACTION_TRIGGERS.includes(trig.event);
    const triggerFields = [
      field(`${base}.trigger.event`, t("MODULUS.Talent.Field.event"), "select", trig.event, { "": "—", ...opts(Object.keys(TRIGGERS), "MODULUS.Talent.Trigger") }),
      field(`${base}.trigger.actor`, t("MODULUS.Talent.Field.actor"), "select", trig.actor, opts(ACTOR_SCOPES, "MODULUS.Talent.Actor"))
    ];
    if (isAction) {
      triggerFields.push(field(`${base}.trigger.tagsAll`, t("MODULUS.Talent.Field.tagsAll"), "list", trig.tagsAll.join(", ")));
      if (["actionUsed", "wordUsed"].includes(trig.event)) {
        triggerFields.push(field(`${base}.trigger.timing`, t("MODULUS.Talent.Field.timing"), "select", trig.timing, opts(["declare", "resolve"], "MODULUS.Talent.Option")));
        if (trig.timing === "resolve") triggerFields.push(field(`${base}.trigger.outcome`, t("MODULUS.Talent.Field.outcome"), "select", trig.outcome, opts(["any", "hit", "miss"], "MODULUS.Talent.Option")));
      }
    }
    for (const p of TRIGGERS[trig.event]?.params ?? []) {
      triggerFields.push(optionField(`${base}.trigger.params`, p.key, p.options ?? p.type, trig.params?.[p.key]));
    }
    const conditions = (d.conditions ?? []).map((c, ci) => {
      const cb = `${base}.conditions.${ci}`;
      return {
        index: ci,
        fields: [
          field(`${cb}.type`, t("MODULUS.Talent.Field.condition"), "select", c.type, opts(CONDITION_TYPES, "MODULUS.Talent.Condition")),
          ...(CONDITION_FIELDS[c.type] ?? []).map(([key, spec]) => optionField(cb, key, spec, c[key]))
        ]
      };
    });
    const shiftStats = shiftStatOptions();
    const shifts = d.grant.tierShifts.map((s, si) => ({
      index: si,
      fields: [
        field(`${base}.grant.tierShifts.${si}.stat`, t("MODULUS.Talent.Field.stat"), "select", s.stat, shiftStats),
        field(`${base}.grant.tierShifts.${si}.delta`, t("MODULUS.Talent.Field.delta"), "int", s.delta)
      ]
    }));
    const dice = d.grant.dice.map((x, di) => ({
      index: di,
      fields: [
        field(`${base}.grant.dice.${di}.stat`, t("MODULUS.Talent.Field.stat"), "select", x.stat === "*" ? "any" : x.stat, { any: t("MODULUS.Talent.AllStats"), ...shiftStats }),
        field(`${base}.grant.dice.${di}.buff`, t("MODULUS.Effect.Arg.buff"), "int", x.buff),
        field(`${base}.grant.dice.${di}.debuff`, t("MODULUS.Effect.Arg.debuff"), "int", x.debuff)
      ]
    }));
    const grantFields = [
      field(`${base}.grant.applyTo`, t("MODULUS.Talent.Field.applyTo"), "select", d.grant.applyTo, opts(APPLY_TO, "MODULUS.Talent.ApplyTo")),
      field(`${base}.grant.appliesToRolls`, t("MODULUS.Talent.Field.appliesToRolls"), "select", d.grant.appliesToRolls, opts(["all", "attack", "defense"], "MODULUS.Talent.Option"))
    ];
    const timeFields = [
      field(`${base}.duration.rounds`, t("MODULUS.Talent.Field.rounds"), "int", d.duration.rounds),
      field(`${base}.duration.until`, t("MODULUS.Talent.Field.until"), "select", d.duration.until ?? "", { "": t("MODULUS.Talent.Option.byRounds"), ...opts(["endOfRound", "startOfOwnerNextTurn", "encounterEnd"], "MODULUS.Talent.Option") }),
      field(`${base}.stacking`, t("MODULUS.Talent.Field.stacking"), "select", d.stacking, opts(["refresh", "stack", "ignore"], "MODULUS.Talent.Option")),
      ...(d.stacking === "stack" ? [field(`${base}.maxStacks`, t("MODULUS.Talent.Field.maxStacks"), "int", d.maxStacks)] : []),
      field(`${base}.limitPerRound`, t("MODULUS.Talent.Field.limitPerRound"), "int", d.limitPerRound)
    ];
    const check = validateCondFx(raw);
    return {
      index,
      id: d.id,
      label: d.label,
      labelName: `${base}.label`,
      idName: `${base}.id`,
      triggerFields,
      conditions,
      shifts,
      dice,
      grantFields,
      timeFields,
      preview: describeCondFx(raw, { stat: statLabel }),
      errors: check.errors.map((e) => t(`MODULUS.Talent.Check.${e}`)),
      warnings: check.warnings.map((w) => t(`MODULUS.Talent.Check.${w}`))
    };
  });
}

const int = (v) => (v === "" || v == null ? undefined : Math.trunc(Number(v)) || 0);
const list = (v) => String(v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ordered = (obj) => Object.entries(obj ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v);

/** Rebuild records from the expanded `_cfx` form object, keeping the previous ones for comparison. */
export function recordsFromForm(form, previous = []) {
  return ordered(form).map((row, i) => {
    const prev = normalizeCondFx(previous[i] ?? {});
    const trigger = row.trigger ?? {};
    const eventChanged = (trigger.event ?? "") !== prev.trigger.event;
    const params = {};
    if (!eventChanged) {
      for (const p of TRIGGERS[trigger.event]?.params ?? []) {
        const v = trigger.params?.[p.key];
        if (v === undefined || v === "") continue;
        params[p.key] = p.type === "int" ? int(v) : p.type === "list" ? list(v) : v;
      }
    }
    const conditions = ordered(row.conditions).map((c, ci) => {
      const prevType = prev.conditions?.[ci]?.type;
      if (c.type !== prevType) return { type: c.type };
      const out = { type: c.type };
      for (const [key, spec] of CONDITION_FIELDS[c.type] ?? []) {
        const v = c[key];
        if (v === undefined || v === "") continue;
        out[key] = spec === "int" ? int(v) : spec === "bool" ? Boolean(v) : spec === "list" ? list(v) : v;
      }
      return out;
    });
    const record = {
      id: row.id || prev.id || `cfx_${foundry.utils.randomID(6)}`,
      label: row.label ?? "",
      trigger: {
        event: trigger.event ?? "",
        actor: trigger.actor ?? "self",
        tagsAll: eventChanged ? prev.trigger.tagsAll : list(trigger.tagsAll),
        timing: trigger.timing ?? prev.trigger.timing,
        outcome: trigger.outcome ?? "any",
        params
      },
      conditions,
      grant: {
        tierShifts: ordered(row.grant?.tierShifts).map((s) => ({ stat: s.stat ?? "rollStat", delta: int(s.delta) ?? 0 })),
        dice: ordered(row.grant?.dice).map((d) => ({ stat: d.stat ?? "any", buff: Math.max(0, int(d.buff) ?? 0), debuff: Math.max(0, int(d.debuff) ?? 0) })),
        applyTo: row.grant?.applyTo ?? "self",
        appliesToRolls: row.grant?.appliesToRolls ?? "all"
      },
      duration: { rounds: Math.max(0, int(row.duration?.rounds) ?? 1), until: row.duration?.until || null },
      stacking: row.stacking ?? "refresh",
      maxStacks: Math.max(1, int(row.maxStacks) ?? prev.maxStacks),
      limitPerRound: Math.max(0, int(row.limitPerRound) ?? 1)
    };
    return record;
  });
}

export function newRecord() {
  return {
    id: `cfx_${foundry.utils.randomID(6)}`,
    label: "",
    trigger: { event: "actionUsed", actor: "self", tagsAll: [], timing: "resolve", outcome: "hit", params: {} },
    conditions: [],
    grant: { tierShifts: [{ stat: "rollStat", delta: 1 }], dice: [], applyTo: "self", appliesToRolls: "all" },
    duration: { rounds: 1, until: null },
    stacking: "refresh",
    maxStacks: 1,
    limitPerRound: 1
  };
}
