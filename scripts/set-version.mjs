/**
 * Sets "version" in system.json (and "download", when the manifest has a "url", to that version's
 * release zip), keeping the file's layout.
 *   node scripts/set-version.mjs <version>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(`not a version: ${version}`);
  process.exit(2);
}
const path = fileURLToPath(new URL("../system.json", import.meta.url));
const text = readFileSync(path, "utf8");
const url = JSON.parse(text).url;
let next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (url) next = next.replace(/("download"\s*:\s*")[^"]*(")/, `$1${url}/releases/download/v${version}/modulus-v${version}.zip$2`);
if (JSON.parse(next).version !== version) {
  console.error("could not set the version");
  process.exit(1);
}
if (next !== text) writeFileSync(path, next);
console.log(`system.json version ${version}`);
