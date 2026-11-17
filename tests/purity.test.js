// §0.2.1: rules/ must have zero Foundry imports or globals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

test("rules engine does not touch Foundry", () => {
  const dir = new URL("../module/rules/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const i of imports) assert.ok(i.startsWith("./"), `${f} imports ${i}`);
    assert.ok(!/\b(game|foundry|CONFIG|Hooks|ui)\./.test(src), `${f} references a Foundry global`);
  }
});
