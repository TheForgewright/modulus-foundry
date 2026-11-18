/**
 * Every literal data-action in a template is registered on every window or sheet whose PARTS
 * render that template (or is a core ApplicationV2 action). A template with data-action that no
 * window renders fails too. Also fails if a class assigns ApplicationV2's own state, rendered,
 * element, form or window.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { installFoundryStubs, ROOT, SYSTEM_PREFIX } from "./foundry-stubs.mjs";

installFoundryStubs();

export const CORE_ACTIONS = new Set([
  "tab", "close", "toggleControls", "minimize", "maximize", "editImage", "configureSheet", "copyUuid",
  "configurePrototypeToken", "showPortraitArtwork", "showTokenArtwork", "toggleFieldset"
]);
const RESERVED = ["state", "rendered", "element", "form", "window"];

const walk = (dir, ext, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (f.endsWith(ext)) out.push(p);
  }
  return out;
};

const classes = [];
for (const file of walk(join(ROOT, "module"), ".js")) {
  const mod = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "function" || !value.PARTS || classes.some((c) => c.cls === value)) continue;
    const templates = Object.values(value.PARTS).map((p) => p.template).filter(Boolean);
    const actions = new Set(Object.keys(value.DEFAULT_OPTIONS?.actions ?? {}));
    classes.push({ name, cls: value, file: relative(ROOT, file), templates, actions });
  }
}

const failures = [];
for (const file of walk(join(ROOT, "templates"), ".hbs")) {
  const path = SYSTEM_PREFIX + relative(ROOT, file).replace(/\\/g, "/");
  const actions = [...readFileSync(file, "utf8").matchAll(/data-action="([^"{]*)"/g)].map((m) => m[1]);
  if (!actions.length) continue;
  const users = classes.filter((c) => c.templates.some((t) => t.replace("${SYSTEM_ID}", "modulus") === path));
  if (!users.length) {
    failures.push(`${path} has data-action but no window renders it`);
    continue;
  }
  for (const a of new Set(actions)) {
    if (CORE_ACTIONS.has(a)) continue;
    for (const u of users) if (!u.actions.has(a)) failures.push(`${path}: action "${a}" is not registered on ${u.name} (${u.file})`);
  }
}

for (const file of walk(join(ROOT, "module"), ".js")) {
  const src = readFileSync(file, "utf8");
  for (const r of RESERVED) {
    if (new RegExp(`this\\.${r}\\s*=[^=]`).test(src)) failures.push(`${relative(ROOT, file)} assigns this.${r} (reserved by ApplicationV2)`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`actions-check: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`actions-check: ${classes.length} windows, every template action registered`);
