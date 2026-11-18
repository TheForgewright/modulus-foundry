/**
 * Imports every module under module/ with stand-in Foundry globals, runs the init hook, and checks
 * that what init registers points at real files: templates, the manifest's scripts, styles,
 * languages and packs. Fails on any error.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { installFoundryStubs, Hooks, registry, ROOT } from "./foundry-stubs.mjs";

installFoundryStubs();

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".js")) files.push(p);
  }
};
walk(join(ROOT, "module"));

const failures = [];
for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
  } catch (err) {
    failures.push(`import ${relative(ROOT, f)}: ${err.stack ?? err}`);
  }
}

try {
  Hooks.callAll("init");
} catch (err) {
  failures.push(`init hook: ${err.stack ?? err}`);
}

for (const p of registry.missingTemplates) failures.push(`loadTemplates names a missing file: ${p}`);
if (!registry.sheets.length) failures.push("init registered no sheets");
if (!Object.keys(CONFIG.Actor.dataModels).length) failures.push("init registered no actor data models");

const manifest = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));
for (const p of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map((l) => l.path), ...(manifest.packs ?? []).map((p) => p.path)]) {
  if (!existsSync(join(ROOT, p))) failures.push(`system.json names a missing path: ${p}`);
}
for (const type of Object.keys(manifest.documentTypes?.Actor ?? {})) {
  if (!CONFIG.Actor.dataModels[type]) failures.push(`Actor type "${type}" has no data model`);
}
for (const type of Object.keys(manifest.documentTypes?.Item ?? {})) {
  if (!CONFIG.Item.dataModels[type]) failures.push(`Item type "${type}" has no data model`);
}

// Every template path written in the code exists.
for (const f of files) {
  for (const m of readFileSync(f, "utf8").matchAll(/systems\/\$\{SYSTEM_ID\}\/(templates\/[\w/.-]+\.hbs)|systems\/modulus\/(templates\/[\w/.-]+\.hbs)/g)) {
    const p = m[1] ?? m[2];
    if (!existsSync(join(ROOT, p))) failures.push(`${relative(ROOT, f)} names a missing template: ${p}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`load-check: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`load-check: ${files.length} modules imported, init ran, ${registry.settings.size} settings, ${registry.templates.length} templates`);
