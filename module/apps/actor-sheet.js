/**
 * Character / NPC sheet (§15): dot allocator, tier badges, pip tracks with break
 * points, momentum block, statuses and other owned items, XP and level.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS, EXPRESSIONS, statKey } from "../rules/constants.js";
import { getSetting } from "../settings.js";
import { openRollDialog } from "./roll-dialog.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const T = (p) => `systems/${SYSTEM_ID}/templates/actor/${p}.hbs`;

const ITEM_SECTIONS = ["status", "action", "word", "talent", "skill", "ancestry", "society", "background", "armor"];

export class ModulusActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "sheet", "actor"],
    position: { width: 760, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      pickDomain: ModulusActorSheet.#onPickDomain,
      pickExpression: ModulusActorSheet.#onPickExpression,
      pickFreeDot: ModulusActorSheet.#onPickFreeDot,
      resetAllocation: ModulusActorSheet.#onResetAllocation,
      rollStat: ModulusActorSheet.#onRollStat,
      rollManual: ModulusActorSheet.#onRollManual,
      pip: ModulusActorSheet.#onPip,
      rest: ModulusActorSheet.#onRest,
      clearDefeat: ModulusActorSheet.#onClearDefeat,
      createItem: ModulusActorSheet.#onCreateItem,
      editItem: ModulusActorSheet.#onEditItem,
      deleteItem: ModulusActorSheet.#onDeleteItem,
      switchTab: ModulusActorSheet.#onSwitchTab
    }
  };

  static PARTS = {
    header: { template: T("header") },
    nav: { template: T("nav") },
    main: { template: T("main") },
    items: { template: T("items"), scrollable: [""] },
    notes: { template: T("notes") }
  };

  tabGroups = { primary: "main" };

  get isNPC() {
    return this.document.type === "npc";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const t = (k) => game.i18n.localize(k);
    const alloc = system.allocation;
    const direct = this.isNPC && system.statsMode === "direct";
    const allocating = !direct && !system.allocationStatus.complete;

    const grid = DOMAINS.map((d) => ({
      domain: d,
      label: t(`MODULUS.Domain.${d}`),
      chosen: alloc.domain === d,
      cells: EXPRESSIONS.map((e) => {
        const key = statKey(d, e);
        const stat = system.stats[d][e];
        const eff = actor.getEffectiveTier(key);
        return {
          key,
          domain: d,
          expression: e,
          label: t(`MODULUS.Stat.${d}_${e}`),
          dots: [0, 1].map((i) => i < stat.dots),
          tier: stat.tier,
          tierLabel: t(`MODULUS.Tier.${stat.tier}`),
          effTier: eff.tier,
          effTierLabel: t(`MODULUS.Tier.${eff.tier}`),
          degraded: eff.tier !== stat.tier || eff.extraDebuffDice > 0,
          extraDebuff: eff.extraDebuffDice,
          intersection: alloc.domain === d && alloc.expression === e,
          freeDot: alloc.freeDot === key,
          bonus: stat.bonus,
          bonusName: `system.stats.${d}.${e}.bonus`,
          directName: `system.directTiers.${d}.${e}`,
          directValue: direct ? system.directTiers[d][e] : null
        };
      })
    }));

    const tracks = DOMAINS.map((d) => {
      const tr = system.tracks[d];
      return {
        domain: d,
        label: t(`MODULUS.Domain.${d}`),
        tierLabel: t(`MODULUS.Tier.${tr.tier}`),
        max: tr.max,
        remaining: tr.remaining,
        segments: tr.segments,
        defeated: tr.defeated,
        depleted: tr.depleted,
        defeatCleared: tr.defeatCleared,
        defeatLabel: t(`MODULUS.Defeat.${d}`),
        breakPointsReached: tr.breakPointsReached,
        maxOverride: tr.maxOverride,
        maxOverrideName: `system.tracks.${d}.maxOverride`
      };
    });

    const items = ITEM_SECTIONS.map((type) => ({
      type,
      label: t(`TYPES.Item.${type}`),
      items: actor.items.filter((i) => i.type === type).sort((a, b) => a.sort - b.sort)
    }));

    Object.assign(context, {
      actor,
      system,
      source: system._source,
      isGM: game.user.isGM,
      isNPC: this.isNPC,
      direct,
      allocating,
      alloc,
      allocErrors: system.allocationStatus.errors.map(t),
      expressions: EXPRESSIONS.map((e) => ({ expression: e, label: t(`MODULUS.Expression.${e}`), chosen: alloc.expression === e })),
      grid,
      shape: system.shape,
      tracks,
      domains: DOMAINS.map((d) => ({ domain: d, label: t(`MODULUS.Domain.${d}`), resistance: system.momentum.resistance[d] })),
      items,
      showBonus: getSetting("showAdvancedBonus"),
      tab: this.tabGroups.primary,
      tabs: ["main", "items", "notes"].map((id) => ({ id, label: t(`MODULUS.Sheet.Tab.${id}`), active: this.tabGroups.primary === id })),
      tierChoices: { primary: t("MODULUS.Tier.primary"), secondary: t("MODULUS.Tier.secondary"), tertiary: t("MODULUS.Tier.tertiary") },
      statsModeChoices: { dots: t("MODULUS.NPC.StatsMode.dots"), direct: t("MODULUS.NPC.StatsMode.direct") },
      systemFields: system.schema.fields,
      tabActive: { main: this.tabGroups.primary === "main", items: this.tabGroups.primary === "items", notes: this.tabGroups.primary === "notes" },
      biographyHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.biography, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /* ---------------- Allocation (§3.2) ---------------- */

  static async #onPickDomain(event, target) {
    if (!this.isEditable) return;
    const domain = target.dataset.domain;
    const alloc = this.document.system.allocation;
    const update = { "system.allocation.domain": domain };
    if (alloc.freeDot === statKey(domain, alloc.expression || "x")) update["system.allocation.freeDot"] = "";
    await this.document.update(update);
  }

  static async #onPickExpression(event, target) {
    if (!this.isEditable) return;
    const expression = target.dataset.expression;
    const alloc = this.document.system.allocation;
    const update = { "system.allocation.expression": expression };
    if (alloc.domain && alloc.freeDot === statKey(alloc.domain, expression)) update["system.allocation.freeDot"] = "";
    await this.document.update(update);
  }

  static async #onPickFreeDot(event, target) {
    if (!this.isEditable) return;
    const key = target.dataset.stat;
    const alloc = this.document.system.allocation;
    if (alloc.domain && alloc.expression && key === statKey(alloc.domain, alloc.expression)) {
      ui.notifications.warn("MODULUS.Allocation.Error.FreeDotOnIntersection", { localize: true });
      return;
    }
    await this.document.update({ "system.allocation.freeDot": alloc.freeDot === key ? "" : key });
  }

  /** §3.4: a manual way to re-run the allocator. Respec rules are [OPEN #23]. */
  static async #onResetAllocation() {
    if (!this.isEditable) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "MODULUS.Allocation.Reset" },
      content: `<p>${game.i18n.localize("MODULUS.Allocation.ResetConfirm")}</p>`
    });
    if (ok) await this.document.update({ "system.allocation": { domain: "", expression: "", freeDot: "" } });
  }

  /* ---------------- Rolls ---------------- */

  static #onRollStat(event, target) {
    openRollDialog(this.document, { statKey: target.dataset.stat });
  }

  static #onRollManual() {
    openRollDialog(this.document);
  }

  /* ---------------- Tracks (§4, hand tools §15) ---------------- */

  static #onPip(event, target) {
    if (!this.isEditable) return;
    const amount = Number(target.dataset.amount);
    this.document.applyPips(target.dataset.domain, amount);
  }

  static #onRest(event, target) {
    if (!game.user.isGM) return;
    this.document.rest(target.dataset.kind);
  }

  static #onClearDefeat(event, target) {
    if (!game.user.isGM) return;
    this.document.clearDefeat(target.dataset.domain);
  }

  /* ---------------- Items ---------------- */

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const [item] = await this.document.createEmbeddedDocuments("Item", [{
      name: game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) }),
      type
    }]);
    item?.sheet.render(true);
  }

  static #onEditItem(event, target) {
    this.document.items.get(target.closest("[data-item-id]").dataset.itemId)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (item) await item.deleteDialog();
  }

  static #onSwitchTab(event, target) {
    this.tabGroups.primary = target.dataset.tab;
    this.render();
  }
}
