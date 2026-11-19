import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCatalog } from "../module/rules/catalog.js";

test("compendium entries are used directly; a world copy overrides the entry it came from", () => {
  const world = [{ uuid: "Item.a", sourceUuid: "Compendium.modulus.words.Item.x" }, { uuid: "Item.b" }];
  const pack = [{ uuid: "Compendium.modulus.words.Item.x" }, { uuid: "Compendium.modulus.words.Item.y" }];
  assert.deepEqual(mergeCatalog(world, pack).map((i) => i.uuid), ["Item.a", "Item.b", "Compendium.modulus.words.Item.y"]);
  assert.deepEqual(mergeCatalog([], pack).map((i) => i.uuid), pack.map((p) => p.uuid));
});
