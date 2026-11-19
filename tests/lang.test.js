// Every localization key the code and templates use must exist in lang/en.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { EFFECT_OPS, EFFECT_TRIGGERS, EFFECT_TARGETS } from "../module/rules/effects.js";
import { HAND_NAMES } from "../module/rules/deck.js";
import { PHASES, ENTRY_STATES } from "../module/rules/encounter.js";
import { TRIGGERS, ACTOR_SCOPES, APPLY_TO, CONDITION_TYPES } from "../module/rules/condfx.js";

// Every `log(s, "<type>")` call in the engine.
const ENCOUNTER_LOG_TYPES = [...readFileSync("module/rules/encounter.js", "utf8").matchAll(/log\(s(?:tate)?, "(\w+)"/g)].map((m) => m[1]);

const lang = JSON.parse(readFileSync("lang/en.json", "utf8"));
const get = (k) => k.split(".").reduce((o, p) => o?.[p], lang);
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

test("static keys in code and templates exist", () => {
  const missing = [];
  for (const f of [...files("module"), ...files("templates")]) {
    for (const m of readFileSync(f, "utf8").matchAll(/"((?:MODULUS|TYPES)\.[A-Za-z0-9_.]+[A-Za-z0-9_])"/g)) {
      const v = get(m[1]);
      // A string naming a group (e.g. a prefix passed to an option-list helper) is fine.
      if (typeof v !== "string" && !(v && typeof v === "object")) missing.push(`${m[1]} (${f})`);
    }
  }
  assert.deepEqual(missing, []);
});

test("every option value in the talent editor has a label", () => {
  const src = readFileSync("module/talents/condfx-editor.js", "utf8");
  const values = new Set();
  for (const m of src.matchAll(/opts\(\[([^\]]*)\],\s*"MODULUS\.Talent\.Option"\)/g)) for (const v of m[1].matchAll(/"(\w+)"/g)) values.add(v[1]);
  for (const m of src.matchAll(/\["\w+", \[([^\]]*)\]\]/g)) for (const v of m[1].matchAll(/"(\w+)"/g)) values.add(v[1]);
  assert.ok(values.size > 10);
  assert.deepEqual([...values].filter((v) => typeof get(`MODULUS.Talent.Option.${v}`) !== "string"), []);
});

test("dynamic catalog keys exist", () => {
  const keys = [
    ...Object.keys(EFFECT_OPS).map((k) => `MODULUS.Effect.Op.${k}`),
    ...EFFECT_TRIGGERS.map((k) => `MODULUS.Effect.Trigger.${k}`),
    ...EFFECT_TARGETS.map((k) => `MODULUS.Effect.To.${k}`),
    ...Object.values(EFFECT_OPS).flatMap((d) => d.args.map((a) => `MODULUS.Effect.Arg.${a.key}`)),
    ...Object.values(EFFECT_OPS).flatMap((d) => d.args.flatMap((a) => (a.options ?? []).map((o) => `MODULUS.Effect.Option.${o}`))),
    ...Object.values(HAND_NAMES).map((k) => `MODULUS.Hand.${k}`),
    ...["tooManyWords", "needsRecovery", "unaffordable", "noRollStat", "noTargetStat"].map((k) => `MODULUS.Builder.Error.${k}`),
    ...["statOverrideConflict", "duplicateWord", "offensiveOnSelf"].map((k) => `MODULUS.Builder.Warning.${k}`),
    ...PHASES.map((k) => `MODULUS.Encounter.Phase.${k}`),
    ...ENTRY_STATES.map((k) => `MODULUS.Encounter.State.${k}`),
    ...["hit", "miss", "resolved", "charging"].map((k) => `MODULUS.Encounter.Outcome.${k}`),
    ...["defeated", "negativeMomentum", "allDepleted"].map((k) => `MODULUS.Encounter.Flag.${k}`),
    ...["declare", "reconfirm", "duelist"].map((k) => `MODULUS.Encounter.Waiting.${k}`),
    ...["noAction", "taxingCooldown", "noSuchEntry", "ownEntry", "notYourTurn", "notPrompted", "notDuelistTurn"].map((k) => `MODULUS.Encounter.Error.${k}`),
    ...ENCOUNTER_LOG_TYPES.map((k) => `MODULUS.Encounter.Log.${k}`),
    ...["standard", "relationship", "investigation", "ordeal"].map((k) => `MODULUS.Encounter.Kind.${k}`),
    ...Object.keys(TRIGGERS).map((k) => `MODULUS.Talent.Trigger.${k}`),
    ...Object.values(TRIGGERS).flatMap((d) => d.params.flatMap((p) => [`MODULUS.Talent.Field.${p.key}`, ...(p.options ?? []).map((o) => `MODULUS.Talent.Option.${o}`)])),
    ...ACTOR_SCOPES.map((k) => `MODULUS.Talent.Actor.${k}`),
    ...APPLY_TO.map((k) => `MODULUS.Talent.ApplyTo.${k}`),
    ...CONDITION_TYPES.map((k) => `MODULUS.Talent.Condition.${k}`),
    ...["needSameDomain", "noPrereqSet", "needPrereq", "needCross", "needXP", "needRequired"].map((k) => `MODULUS.Talent.Reason.${k}`),
    ...["noId", "duplicateId", "badTier", "noDomain", "tier1HasPrereq", "crossOnlyTier3", "noPrereqSet", "prereqNotFound", "prereqWrongTier", "crossNotFound", "crossWrongTier", "crossIsParentsOwn", "requiresSelf", "requiredNotFound", "cycle"].map((k) => `MODULUS.Talent.Issue.${k}`),
    ...["noTrigger", "unknownTrigger", "emptyGrant", "outcomeNeedsResolve", "badStat", "zeroDelta", "passiveBonus"].map((k) => `MODULUS.Talent.Check.${k}`)
  ];
  assert.deepEqual(keys.filter((k) => typeof get(k) !== "string"), []);
});
