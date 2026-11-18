/**
 * Zips the shipped system as <out> with a top-level "modulus/" folder. Only the files Foundry needs
 * go in (system.json, module/, templates/, styles/, lang/, packs/); pack sources and pack LOCK / LOG
 * files stay out. Entries are sorted and dated, so the same tree gives the same zip.
 *   node scripts/make-zip.mjs <out.zip>
 */
import yazl from "yazl";
import { createWriteStream, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2];
if (!out) {
  console.error("usage: make-zip.mjs <out.zip>");
  process.exit(2);
}
const root = fileURLToPath(new URL("../", import.meta.url));

export const SHIPPED = ["system.json", "module", "templates", "styles", "lang", "packs", "LICENSE"];
export const EXCLUDED = (p) => /^packs\/_source(\/|$)/.test(p) || /^packs\/[^/]+\/(LOCK|LOG(\.old)?)$/.test(p) || /(^|\/)\.gitkeep$/.test(p);

const files = [];
const walk = (p) => {
  const rel = relative(root, p).replace(/\\/g, "/");
  if (EXCLUDED(rel)) return;
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else files.push(rel);
};
for (const entry of SHIPPED) if (existsSync(join(root, entry))) walk(join(root, entry));
files.sort();

const mtime = new Date(2026, 0, 1);
const zip = new yazl.ZipFile();
for (const rel of files) zip.addFile(join(root, rel), `modulus/${rel}`, { mtime, mode: 0o100644 });
zip.end();
await new Promise((resolve, reject) => zip.outputStream.pipe(createWriteStream(out)).on("close", resolve).on("error", reject));
console.log(`zipped ${files.length} files -> ${out}`);
