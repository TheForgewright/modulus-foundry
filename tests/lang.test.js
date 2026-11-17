// Every localization key the code and templates use must exist in lang/en.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { EFFECT_OPS, EFFECT_TRIGGERS, EFFECT_TARGETS } from "../module/rules/effects.js";
import { HAND_NAMES } from "../module/rules/deck.js";

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
      if (typeof get(m[1]) !== "string") missing.push(`${m[1]} (${f})`);
    }
  }
  assert.deepEqual(missing, []);
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
    ...["statOverrideConflict", "duplicateWord", "offensiveOnSelf"].map((k) => `MODULUS.Builder.Warning.${k}`)
  ];
  assert.deepEqual(keys.filter((k) => typeof get(k) !== "string"), []);
});
