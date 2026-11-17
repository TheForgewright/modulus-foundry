/**
 * Compile packs/_source/<pack>/*.json into Foundry LevelDB packs at packs/<pack>.
 * Usage: npm install && npm run build:packs
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const SRC = "packs/_source";
for (const name of readdirSync(SRC)) {
  const src = path.join(SRC, name);
  if (!statSync(src).isDirectory()) continue;
  const dest = path.join("packs", name);
  rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { log: true });
  console.log(`Built ${dest}`);
}
