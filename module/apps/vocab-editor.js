/**
 * Vocabulary Editor (§15): list, filter and edit actions, words, statuses, talents and
 * skills; manage the tag registry; import and export JSON for everything or a selection.
 * Works on world Items. Designers spend most of their time here.
 */
import { SYSTEM_ID } from "../config.js";
import { VOCAB_TYPES, exportVocabulary, parseVocabulary, planImport, mergeTagRegistry } from "../rules/vocab-io.js";
import { formatTags, normalizeTagName, ENGINE_TAGS } from "../rules/tags.js";
import { describeEffect } from "../rules/effects.js";
import { getSetting, tagRegistry } from "../settings.js";
import { statLabel } from "./item-sheet.js";
import { openSyncDialog } from "../compendium/sync.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export function vocabIdOf(item) {
  return item.getFlag(SYSTEM_ID, "vocabId") ?? item.id;
}

export class VocabularyEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modulus-vocab-editor",
    classes: ["modulus", "vocab-editor"],
    window: { title: "MODULUS.Vocab.Title", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 900, height: 700 },
    actions: {
      tab: VocabularyEditor.#onTab,
      create: VocabularyEditor.#onCreate,
      edit: VocabularyEditor.#onEdit,
      duplicate: VocabularyEditor.#onDuplicate,
      delete: VocabularyEditor.#onDelete,
      toggleAll: VocabularyEditor.#onToggleAll,
      exportJSON: VocabularyEditor.#onExport,
      importJSON: VocabularyEditor.#onImport,
      addTag: VocabularyEditor.#onAddTag,
      deleteTag: VocabularyEditor.#onDeleteTag,
      syncCompendiums: () => openSyncDialog(),
      talentGraph: () => game.modulus.openTalentGraph()
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/vocab-editor.hbs`, scrollable: [".vocab-list", ".tag-list"] }
  };

  /** Singleton accessor. */
  static open() {
    this._instance ??= new this();
    this._instance.render({ force: true });
    return this._instance;
  }

  tab = "items";
  filter = { type: "", text: "", group: "" };
  selected = new Set();

  #hooks = [];

  get vocabItems() {
    return game.items.filter((i) => VOCAB_TYPES.includes(i.type));
  }

  _filtered() {
    const text = this.filter.text.toLowerCase();
    return this.vocabItems.filter((i) => {
      if (this.filter.type && i.type !== this.filter.type) return false;
      if (this.filter.group && i.system.groups?.tree !== this.filter.group) return false;
      if (!text) return true;
      const tags = (i.system.tags ?? []).map((t) => t.name).join(" ");
      return `${i.name} ${tags}`.toLowerCase().includes(text);
    }).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  _summary(item) {
    const s = item.system;
    const parts = [];
    if (item.type === "action") {
      if (s.rollStat) parts.push(`${statLabel(s.rollStat)} → ${statLabel(s.targetStat) || "—"}`);
      parts.push(`${game.i18n.localize("MODULUS.Field.momentumCost")} ${s.momentumCost}`);
      if (s.trained) parts.push(game.i18n.localize("MODULUS.Field.trained"));
    } else if (item.type === "word") {
      parts.push(`${s.momentumModifier >= 0 ? "+" : ""}${s.momentumModifier}`);
      if (s.baseWord) parts.push(game.i18n.localize("MODULUS.Vocab.Base"));
      if (s.trained) parts.push(game.i18n.localize("MODULUS.Field.trained"));
    } else if (item.type === "talent") {
      parts.push(`${game.i18n.localize(`MODULUS.Domain.${s.domain || "physical"}`)} ${s.tier}`);
    } else if (item.type === "status") {
      parts.push(game.i18n.localize(`MODULUS.Status.Duration.${s.duration.type}`));
    } else if (item.type === "skill") {
      parts.push(`${game.i18n.localize("MODULUS.Field.rank")} ${s.rank}`);
    }
    return parts.join(" · ");
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    const rows = this._filtered().map((i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      type: i.type,
      typeLabel: t(`TYPES.Item.${i.type}`),
      summary: this._summary(i),
      tags: formatTags(i.system.tags ?? []),
      group: i.system.groups?.tree ?? "",
      effects: (i.system.effects ?? []).map((e) => describeEffect(e, { stat: statLabel })).join("\n"),
      effectCount: (i.system.effects ?? []).length,
      selected: this.selected.has(i.id)
    }));
    const groups = [...new Set(this.vocabItems.map((i) => i.system.groups?.tree).filter(Boolean))].sort();
    const custom = getSetting("tagRegistry") ?? [];
    const usage = new Map();
    for (const i of this.vocabItems) for (const tag of i.system.tags ?? []) usage.set(tag.name, (usage.get(tag.name) ?? 0) + 1);
    return {
      tab: this.tab,
      isItems: this.tab === "items",
      isTags: this.tab === "tags",
      filter: this.filter,
      types: Object.fromEntries(VOCAB_TYPES.map((k) => [k, t(`TYPES.Item.${k}`)])),
      groups: Object.fromEntries(groups.map((g) => [g, g])),
      rows,
      count: rows.length,
      total: this.vocabItems.length,
      selectedCount: [...this.selected].filter((id) => game.items.has(id)).length,
      allSelected: rows.length > 0 && rows.every((r) => r.selected),
      registry: tagRegistry().map((tag) => ({
        ...tag,
        custom: custom.some((c) => c.name === tag.name),
        uses: usage.get(tag.name) ?? 0
      })),
      unregistered: [...usage.keys()].filter((n) => !tagRegistry().some((r) => r.name === n)).sort()
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.querySelector("input.filter-text")?.addEventListener("input", foundry.utils.debounce((ev) => {
      this.filter.text = ev.target.value;
      this.render().then(() => {
        const input = this.element.querySelector("input.filter-text");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }, 250));
    for (const sel of el.querySelectorAll("select[data-filter]")) {
      sel.addEventListener("change", (ev) => {
        this.filter[ev.target.dataset.filter] = ev.target.value;
        this.render();
      });
    }
    for (const box of el.querySelectorAll("input.row-select")) {
      box.addEventListener("change", (ev) => {
        const id = ev.target.closest("[data-item-id]").dataset.itemId;
        if (ev.target.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.render();
      });
    }
    el.querySelector("input.import-file")?.addEventListener("change", (ev) => this.#importFile(ev.target.files?.[0]));
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const rerender = () => this.rendered && this.render();
    for (const hook of ["createItem", "updateItem", "deleteItem"]) this.#hooks.push([hook, Hooks.on(hook, rerender)]);
  }

  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  /* ---------------- Items ---------------- */

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onCreate(event, target) {
    const type = target.dataset.type || this.filter.type || "action";
    const [item] = await Item.createDocuments([{
      name: game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) }),
      type
    }]);
    item?.sheet.render(true);
  }

  static #onEdit(event, target) {
    game.items.get(target.closest("[data-item-id]").dataset.itemId)?.sheet.render(true);
  }

  static async #onDuplicate(event, target) {
    const item = game.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item) return;
    const data = item.toObject();
    delete data._id;
    data.name = `${data.name} (2)`;
    if (data.flags?.[SYSTEM_ID]) delete data.flags[SYSTEM_ID].vocabId;
    await Item.createDocuments([data]);
  }

  static async #onDelete(event, target) {
    const item = game.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (item) await item.deleteDialog();
  }

  static #onToggleAll() {
    const rows = this._filtered();
    const all = rows.every((i) => this.selected.has(i.id));
    for (const i of rows) (all ? this.selected.delete(i.id) : this.selected.add(i.id));
    this.render();
  }

  /* ---------------- Import / export ---------------- */

  static #onExport(event, target) {
    const scope = target.dataset.scope; // "selected" | "filtered" | "all"
    let items = this.vocabItems;
    if (scope === "selected") items = items.filter((i) => this.selected.has(i.id));
    else if (scope === "filtered") items = this._filtered();
    if (!items.length) {
      ui.notifications.warn("MODULUS.Vocab.NothingToExport", { localize: true });
      return;
    }
    const data = exportVocabulary(items.map((i) => ({
      vocabId: vocabIdOf(i),
      type: i.type,
      name: i.name,
      img: i.img,
      folder: i.folder?.name,
      system: i.system.toObject()
    })), getSetting("tagRegistry") ?? []);
    const stamp = new Date().toISOString().slice(0, 10);
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `modulus-vocabulary-${stamp}.json`);
    ui.notifications.info(game.i18n.format("MODULUS.Vocab.Exported", { n: data.items.length }));
  }

  static #onImport() {
    this.element.querySelector("input.import-file")?.click();
  }

  async #importFile(file) {
    if (!file) return;
    const text = await foundry.utils.readTextFromFile(file);
    const parsed = parseVocabulary(text);
    if (!parsed.valid) {
      await DialogV2.prompt({
        window: { title: "MODULUS.Vocab.ImportFailed" },
        content: `<p>${game.i18n.localize("MODULUS.Vocab.ImportFailedHint")}</p><ul>${parsed.errors.map((e) => `<li>${foundry.utils.escapeHTML(e)}</li>`).join("")}</ul>`
      });
      return;
    }
    const existing = new Map(this.vocabItems.map((i) => [vocabIdOf(i), i.id]));
    const plan = planImport(parsed.items, existing);
    const ok = await DialogV2.confirm({
      window: { title: "MODULUS.Vocab.Import" },
      content: `<p>${game.i18n.format("MODULUS.Vocab.ImportConfirm", { create: plan.create.length, update: plan.update.length, tags: parsed.tags.length })}</p>`
    });
    if (!ok) return;

    const folderIds = new Map();
    const folderFor = async (name) => {
      if (!name) return null;
      if (folderIds.has(name)) return folderIds.get(name);
      let folder = game.folders.find((f) => f.type === "Item" && f.name === name);
      folder ??= await Folder.create({ name, type: "Item" });
      folderIds.set(name, folder.id);
      return folder.id;
    };
    const toCreate = [];
    for (const i of plan.create) {
      toCreate.push({
        name: i.name, type: i.type, img: i.img || undefined, system: i.system,
        folder: await folderFor(i.folder),
        flags: { [SYSTEM_ID]: { vocabId: i.vocabId } }
      });
    }
    const toUpdate = plan.update.map((i) => ({
      _id: i.id, name: i.name, ...(i.img ? { img: i.img } : {}), system: i.system,
      [`flags.${SYSTEM_ID}.vocabId`]: i.vocabId
    }));
    if (toCreate.length) await Item.createDocuments(toCreate);
    if (toUpdate.length) await Item.updateDocuments(toUpdate);
    if (parsed.tags.length) {
      await game.settings.set(SYSTEM_ID, "tagRegistry", mergeTagRegistry(getSetting("tagRegistry") ?? [], parsed.tags));
    }
    ui.notifications.info(game.i18n.format("MODULUS.Vocab.Imported", { create: toCreate.length, update: toUpdate.length }));
    this.render();
  }

  /* ---------------- Tag registry ---------------- */

  static async #onAddTag() {
    const el = this.element;
    const name = normalizeTagName(el.querySelector("input.tag-name")?.value);
    if (!name) return;
    if (ENGINE_TAGS.some((t) => t.name === name)) {
      ui.notifications.warn("MODULUS.Vocab.EngineTag", { localize: true });
      return;
    }
    const entry = {
      name,
      valued: el.querySelector("input.tag-valued")?.checked ?? false,
      description: el.querySelector("input.tag-description")?.value ?? ""
    };
    await game.settings.set(SYSTEM_ID, "tagRegistry", mergeTagRegistry(getSetting("tagRegistry") ?? [], [entry]));
    this.render();
  }

  static async #onDeleteTag(event, target) {
    const name = target.closest("[data-tag]").dataset.tag;
    const next = (getSetting("tagRegistry") ?? []).filter((t) => t.name !== name);
    await game.settings.set(SYSTEM_ID, "tagRegistry", next);
    this.render();
  }
}
