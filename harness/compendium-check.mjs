/**
 * Compendium check. For every pack in system.json:
 *   1. its sources exist in packs/_source/<name>/ and the compiled pack in packs/<name>/ holds exactly
 *      those documents (same ids, same data);
 *   2. with a zip given, the zip carries the pack's files, and the pack read back out of the zip holds
 *      the same documents.
 * Fails on any difference, so a build can never ship a missing, empty or stale compendium.
 *   node harness/compendium-check.mjs [dist/modulus-v<version>.zip]
 */
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import yauzl from "yauzl";
import { mkdtempSync, readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const zipPath = process.argv[2];
const manifest = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));
const failures = [];
const report = [];
const scratch = mkdtempSync(join(tmpdir(), "modulus-packs-"));

/** Documents keyed by id, as JSON objects without the CLI's _key. */
function readDocs(dir) {
  const docs = new Map();
  if (!existsSync(dir)) return docs;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const { _key, ...doc } = JSON.parse(readFileSync(join(dir, f), "utf8"));
    docs.set(doc._id, doc);
  }
  return docs;
}

/**
 * Read a pack's documents from a copy: opening a LevelDB rewrites its manifest and log files,
 * and the shipped packs must only ever be written by the pack build.
 */
async function packDocs(packDir, label) {
  const copy = join(scratch, `${label}-db`);
  cpSync(packDir, copy, { recursive: true });
  rmSync(join(copy, "LOCK"), { force: true });
  const out = join(scratch, label);
  await extractPack(copy, out, { log: false });
  return readDocs(out);
}

function compare(name, where, expected, actual) {
  for (const [id, doc] of expected) {
    if (!actual.has(id)) failures.push(`${name}: "${doc.name}" (${id}) is missing from ${where}`);
    else if (!isDeepStrictEqual(actual.get(id), doc)) failures.push(`${name}: "${doc.name}" (${id}) in ${where} differs from its source`);
  }
  for (const [id, doc] of actual) if (!expected.has(id)) failures.push(`${name}: ${where} has "${doc.name}" (${id}), which has no source`);
}

/** Unzip just one folder of the zip into dest. */
function unzipFolder(zip, prefix, dest) {
  return new Promise((resolve, reject) => {
    let count = 0;
    yauzl.open(zip, { lazyEntries: true }, (err, z) => {
      if (err) return reject(err);
      z.on("entry", (entry) => {
        if (!entry.fileName.startsWith(prefix) || entry.fileName.endsWith("/")) return z.readEntry();
        z.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            const target = join(dest, entry.fileName.slice(prefix.length));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.concat(chunks));
            count++;
            z.readEntry();
          });
        });
      });
      z.on("end", () => resolve(count));
      z.readEntry();
    });
  });
}

try {
  if (!manifest.packs?.length) failures.push("system.json declares no packs");
  for (const pack of manifest.packs ?? []) {
    const src = join(ROOT, "packs", "_source", pack.name);
    const built = join(ROOT, pack.path);
    if (!existsSync(src)) failures.push(`${pack.name}: no sources at packs/_source/${pack.name}`);
    if (!existsSync(join(built, "CURRENT"))) {
      failures.push(`${pack.name}: no compiled pack at ${pack.path} (run npm run build:packs)`);
      continue;
    }
    const sources = readDocs(src);
    compare(pack.name, pack.path, sources, await packDocs(built, `built-${pack.name}`));
    let line = `${pack.name}: ${sources.size} entr${sources.size === 1 ? "y" : "ies"}`;
    if (zipPath) {
      const dest = join(scratch, `zip-${pack.name}`);
      const n = await unzipFolder(zipPath, `modulus/${pack.path}/`, dest);
      if (!n || !existsSync(join(dest, "CURRENT"))) failures.push(`${pack.name}: the zip has no compiled pack at modulus/${pack.path}`);
      else {
        compare(pack.name, "the zip", sources, await packDocs(dest, `zipped-${pack.name}`));
        line += `, ${n} files in the zip`;
      }
    }
    report.push(line);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`compendium-check: ${failures.length} failure(s)`);
  process.exit(1);
}
for (const r of report) console.log(`  ${r}`);
console.log(`compendium-check: ${report.length} packs match their sources${zipPath ? " in the build and in the zip" : ""}`);
