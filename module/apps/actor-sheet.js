/**
 * Character / NPC sheet (§15): dot allocator, tier badges, pip tracks with break
 * points, momentum block, statuses and other owned items, XP and level.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS, EXPRESSIONS, statKey } from "../rules/constants.js";
import { getSetting } from "../settings.js";
import { openRollDialog } from "./roll-dialog.js";
import { openActionBuilder } from "./action-builder.js";
import { hasCardAbilities, cardAbilities, markAbilities } from "../deck/card-effects.js";
import { cardView, markText, STANDALONE_DECK } from "../documents/actor.js";
import { evaluateHand, checkHandRequirement, normalizeMark, HAND_NAMES, MAX_HAND_SIZE } from "../rules/deck.js";
import { sourceOf } from "../compendium/sync.js";

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
      buildAction: ModulusActorSheet.#onBuildAction,
      pip: ModulusActorSheet.#onPip,
      rest: ModulusActorSheet.#onRest,
      clearDefeat: ModulusActorSheet.#onClearDefeat,
      createItem: ModulusActorSheet.#onCreateItem,
      editItem: ModulusActorSheet.#onEditItem,
      deleteItem: ModulusActorSheet.#onDeleteItem,
      switchTab: ModulusActorSheet.#onSwitchTab,
      openEncounter: ModulusActorSheet.#onOpenEncounter,
      selectCard: ModulusActorSheet.#onSelectCard,
      drawCards: ModulusActorSheet.#onDrawCards,
      burnSelected: ModulusActorSheet.#onBurnSelected,
      discardMomentum: ModulusActorSheet.#onDiscardMomentum,
      useAbility: ModulusActorSheet.#onUseAbility,
      useMark: ModulusActorSheet.#onUseMark,
      newDeck: ModulusActorSheet.#onNewDeck
    }
  };

  static PARTS = {
    header: { template: T("header") },
    nav: { template: T("nav") },
    main: { template: T("main") },
    items: { template: T("items"), scrollable: [""] },
    cards: { template: T("cards"), scrollable: [""] },
    notes: { template: T("notes") }
  };

  tabGroups = { primary: "main" };

  /** Card ids currently selected in the hand (UI state only, not persisted). */
  _selectedCards = new Set();

  /** Which encounter's deck the Cards tab shows. */
  _deckId = null;

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
      tabs: this._tabIds().map((id) => ({ id, label: t(`MODULUS.Sheet.Tab.${id}`), active: this.tabGroups.primary === id })),
      tierChoices: { primary: t("MODULUS.Tier.primary"), secondary: t("MODULUS.Tier.secondary"), tertiary: t("MODULUS.Tier.tertiary") },
      statsModeChoices: { dots: t("MODULUS.NPC.StatsMode.dots"), direct: t("MODULUS.NPC.StatsMode.direct") },
      systemFields: system.schema.fields,
      tabActive: Object.fromEntries(["main", "items", "cards", "notes"].map((id) => [id, this.tabGroups.primary === id])),
      cards: this._prepareCards(),
      encounters: game.combats.filter((c) => c.combatants.some((x) => x.actor === actor)).map((c) => {
        const combatant = c.combatants.find((x) => x.actor === actor);
        const st = c.encounterState;
        return {
          combatId: c.id, combatantId: combatant.id, label: c.label, momentum: combatant.momentum,
          round: st.round, phase: game.i18n.localize(`MODULUS.Encounter.Phase.${st.phase}`), persistent: c.persistent
        };
      }),
      biographyHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.biography, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  get showCards() {
    const actor = this.document;
    return getSetting("enableDeck") && (hasCardAbilities(actor) || Object.keys(actor.getDecks()).length > 0);
  }

  _tabIds() {
    const ids = ["main", "items"];
    if (this.showCards) ids.push("cards");
    ids.push("notes");
    if (!ids.includes(this.tabGroups.primary)) this.tabGroups.primary = "main";
    return ids;
  }

  /* ---------------- Cards (§10) ---------------- */

  get deckId() {
    const decks = this.document.getDecks();
    if (!this._deckId || !decks[this._deckId]) this._deckId = this.document.defaultDeckId();
    return this._deckId;
  }

  get deck() {
    return this.deckId ? this.document.getDeck(this.deckId) : null;
  }

  _selectedHandCards() {
    const deck = this.deck;
    if (!deck) return [];
    // Keep the order the player picked cards in: it decides which mark is exhausted.
    const byId = new Map(deck.hand.map((c) => [c.id, c]));
    const inHand = [...this._selectedCards].map((id) => byId.get(id)).filter(Boolean);
    this._selectedCards = new Set(inHand.map((c) => c.id));
    return inHand;
  }

  _prepareCards() {
    if (!this.showCards) return null;
    const t = (k) => game.i18n.localize(k);
    const actor = this.document;
    const decks = actor.getDecks();
    const deck = this.deck;
    const selected = this._selectedHandCards();
    const hand = selected.length ? evaluateHand(selected) : null;
    const deckChoices = Object.fromEntries(Object.keys(decks).map((id) => {
      const combat = game.combats.get(id);
      const label = id === STANDALONE_DECK ? t("MODULUS.Deck.Standalone") : (combat?.name || `${t("DOCUMENT.Combat")} ${id}`);
      return [id, label];
    }));
    return {
      enabled: true,
      hasAbilities: hasCardAbilities(actor),
      deckId: this.deckId,
      deckChoices,
      multipleDecks: Object.keys(decks).length > 1,
      deck: deck && {
        draw: deck.draw.length,
        discard: deck.discard.length,
        burned: deck.burned.length,
        size: deck.size,
        reshuffles: deck.reshuffles,
        pendingMomentumLoss: deck.pendingMomentumLoss ?? 0,
        hand: deck.hand.map((c) => ({ ...cardView(c), selected: this._selectedCards.has(c.id) }))
      },
      selectedCount: selected.length,
      maxHand: MAX_HAND_SIZE,
      handLabel: hand ? `${t(`MODULUS.Hand.${hand.name}`)} (${hand.rank})` : null,
      handBaseLabel: hand?.rankUp ? game.i18n.format("MODULUS.Deck.CountsAs", { base: t(`MODULUS.Hand.${hand.baseName}`), n: hand.rankUp }) : null,
      markAbilities: markAbilities(actor).map((a) => {
        const used = deck?.markUses?.[a.key] ?? 0;
        const left = a.uses ? a.uses - used : null;
        return {
          itemId: a.item.id,
          index: a.index,
          label: a.label,
          text: markText(normalizeMark(a.mark)),
          count: a.count,
          left,
          eligible: (left == null || left > 0) && selected.length >= 1 && selected.length <= a.count
        };
      }),
      oneSelected: selected.length === 1,
      abilities: cardAbilities(actor).map((a) => {
        const check = checkHandRequirement(hand, a.req);
        return {
          itemId: a.item.id,
          index: a.index,
          label: a.label,
          minLabel: t(`MODULUS.Hand.${HAND_NAMES[a.req.minRank ?? 0]}`),
          consumeLabel: t(`MODULUS.Deck.Consume.${a.req.consume ?? "selected"}`),
          scaling: (a.req.scaling ?? []).map((row) => ({
            min: t(`MODULUS.Hand.${HAND_NAMES[row.minRank ?? 0]}`),
            text: Object.entries(row).filter(([k]) => k !== "minRank").map(([k, v]) => `${k} ${v}`).join(", ")
          })),
          eligible: check.ok,
          grantText: check.grant ? Object.entries(check.grant).filter(([k]) => k !== "minRank").map(([k, v]) => `${k} ${v}`).join(", ") : ""
        };
      })
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("input.encounter-momentum")) {
      if (input.dataset.bound) continue;
      input.dataset.bound = "1";
      input.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const c = game.combats.get(ev.target.dataset.combatId)?.combatants.get(ev.target.dataset.combatantId);
        c?.setMomentum(ev.target.value);
      });
    }
    const select = this.element.querySelector("select.deck-select");
    if (!select || select.dataset.bound) return;
    select.dataset.bound = "1";
    select.addEventListener("change", (ev) => {
      this._deckId = ev.target.value;
      this._selectedCards.clear();
      this.render();
    });
  }

  static #onSelectCard(event, target) {
    const id = target.dataset.cardId;
    if (this._selectedCards.has(id)) this._selectedCards.delete(id);
    else if (this._selectedCards.size >= MAX_HAND_SIZE) {
      ui.notifications.warn(game.i18n.format("MODULUS.Deck.MaxSelected", { n: MAX_HAND_SIZE }));
      return;
    } else this._selectedCards.add(id);
    this.render({ parts: ["cards"] });
  }

  static async #onDrawCards(event, target) {
    if (!this.isEditable || !this.deckId) return;
    const input = this.element.querySelector("input.draw-count");
    const n = Math.max(1, Math.floor(Number(input?.value) || 1));
    await this.document.drawCards(n, this.deckId);
  }

  static async #onBurnSelected() {
    if (!this.isEditable) return;
    const ids = [...this._selectedCards];
    if (!ids.length) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "MODULUS.Deck.Burn" },
      content: `<p>${game.i18n.format("MODULUS.Deck.BurnConfirm", { n: ids.length })}</p>`
    });
    if (!ok) return;
    this._selectedCards.clear();
    await this.document.burnCards(ids, this.deckId);
  }

  static async #onDiscardMomentum() {
    if (!this.isEditable) return;
    const [card] = this._selectedHandCards();
    if (!card || this._selectedCards.size !== 1) return;
    let aceHigh = false;
    if (card.rank === 14) {
      aceHigh = await foundry.applications.api.DialogV2.wait({
        window: { title: "MODULUS.Deck.AceValue" },
        content: `<p>${game.i18n.localize("MODULUS.Deck.AceValueHint")}</p>`,
        buttons: [
          { action: "low", label: "1", callback: () => false, default: true },
          { action: "high", label: "11", callback: () => true }
        ],
        rejectClose: false
      });
      if (aceHigh == null) return;
    }
    this._selectedCards.clear();
    await this.document.discardForMomentum(card.id, { aceHigh }, this.deckId);
  }

  static async #onUseAbility(event, target) {
    if (!this.isEditable) return;
    const ids = [...this._selectedCards];
    const r = await this.document.useCardAbility(target.dataset.itemId, Number(target.dataset.index), ids, this.deckId);
    if (!r.ok) return;
    this._selectedCards.clear();
    this.render({ parts: ["cards"] });
    if (r.grant?.buff || r.grant?.debuff) {
      openRollDialog(this.document, { buff: r.grant.buff ?? 0, debuff: r.grant.debuff ?? 0 });
    }
  }

  static async #onUseMark(event, target) {
    if (!this.isEditable) return;
    const ids = [...this._selectedCards];
    const ok = await this.document.useMarkAbility(target.dataset.itemId, Number(target.dataset.index), ids, this.deckId);
    if (ok) this._selectedCards.clear();
  }

  static async #onNewDeck() {
    if (!game.user.isGM) return;
    const id = this.deckId ?? game.combat?.id ?? STANDALONE_DECK;
    if (this.deck) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "MODULUS.Deck.New" },
        content: `<p>${game.i18n.localize("MODULUS.Deck.NewConfirm")}</p>`
      });
      if (!ok) return;
    }
    this._selectedCards.clear();
    this._deckId = id;
    await this.document.createDeck(id);
  }

  /**
   * Items dropped from elsewhere become copies on this actor. A copy from a Modulus compendium
   * (directly, or via a world Item that came from one) records its source, so system updates to
   * that compendium entry reach it (compendium/sync.js). Drops from this actor keep core sorting.
   */
  async _onDropItem(event, item) {
    if (!this.isEditable || !item) return null;
    if (item.parent === this.document) return super._onDropItem(event, item);
    const data = item.toObject();
    delete data._id;
    const src = item.pack?.startsWith(`${SYSTEM_ID}.`) ? item.uuid : sourceOf(item);
    if (src) {
      foundry.utils.setProperty(data, "_stats.compendiumSource", src);
      foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.compendiumSource`, src);
    }
    const [created] = await this.document.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
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

  static #onBuildAction() {
    openActionBuilder(this.document);
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

  static #onOpenEncounter(event, target) {
    game.modulus.openEncounterManager(target.dataset.combatId);
  }

  static #onSwitchTab(event, target) {
    this.tabGroups.primary = target.dataset.tab;
    this.render();
  }
}
