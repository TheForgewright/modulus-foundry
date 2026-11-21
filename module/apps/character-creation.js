/**
 * Character creation window (§3.2, §3.7): stats by dot allocation, ancestry, societies,
 * backgrounds, starting words, then a review with the XP cost. Finishing writes it to the character.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS, EXPRESSIONS, statKey } from "../rules/constants.js";
import { computeDots, shapeSummary } from "../rules/allocation.js";
import { tierFromDots } from "../rules/constants.js";
import { REQUIRED_BACKGROUNDS } from "../rules/creation.js";
import { getSetting } from "../settings.js";
import { creationCatalog, planFromActor, checkPlan, creationErrorText, creationXP, finishCreation, isCreated } from "../creation/creation.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEPS = ["stats", "ancestry", "society", "background", "word", "review"];
const CATEGORIES = [...REQUIRED_BACKGROUNDS, "extra"];

export class CharacterCreation extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["modulus", "character-creation"],
    window: { title: "MODULUS.Creation.Title", icon: "fa-solid fa-user-plus", resizable: true },
    position: { width: 700, height: 680 },
    actions: {
      step: CharacterCreation.#onStep,
      next: CharacterCreation.#onNext,
      back: CharacterCreation.#onBack,
      pickDomain: CharacterCreation.#onPickDomain,
      pickExpression: CharacterCreation.#onPickExpression,
      pickFreeDot: CharacterCreation.#onPickFreeDot,
      pickAncestry: CharacterCreation.#onPickAncestry,
      togglePick: CharacterCreation.#onTogglePick,
      openEntry: CharacterCreation.#onOpenEntry,
      finish: CharacterCreation.#onFinish
    }
  };

  static PARTS = { body: { template: `systems/${SYSTEM_ID}/templates/apps/character-creation.hbs`, scrollable: [".creation-body"] } };

  /** Open (or bring forward) the creation window for a character. */
  static open(actor) {
    const id = `modulus-creation-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.render({ force: true });
    return new this(actor, { id }).render({ force: true });
  }

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.step = "stats";
    this.plan = null;
    this.catalog = null;
  }

  get title() {
    return `${game.i18n.localize("MODULUS.Creation.Title")}: ${this.actor.name}`;
  }

  get steps() {
    return STEPS.filter((s) => s !== "word" || getSetting("creation.startingWords") > 0);
  }

  async _prepareContext() {
    const t = (k) => game.i18n.localize(k);
    this.catalog ??= await creationCatalog();
    this.plan ??= planFromActor(this.actor, this.catalog);
    if (!this.steps.includes(this.step)) this.step = "stats";
    const plan = this.plan;
    const check = checkPlan(this.actor, plan, this.catalog);
    const costOf = new Map(check.lines.map((l) => [l.id, l]));
    const errorsFor = (codes) => check.errors.filter((e) => codes.includes(e.code)).map(creationErrorText);
    const stepErrors = {
      stats: errorsFor(["allocation"]),
      ancestry: errorsFor(["needAncestry"]),
      society: [],
      background: errorsFor(["needBackground"]),
      word: errorsFor(["tooManyWords", "baseWordPicked"]),
      review: check.errors.map(creationErrorText)
    };
    const entry = (type, c) => ({
      uuid: c.uuid, name: c.name, img: c.img,
      picked: type === "ancestry" ? plan.ancestry === c.uuid : plan[type].includes(c.uuid),
      cost: costOf.get(c.uuid)?.cost ?? c.xpCost ?? 0,
      free: Boolean(costOf.get(c.uuid)?.free),
      boons: type === "ancestry" ? [
        ["minorBoon", c.item.system.minorBoon], ["majorBoon", c.item.system.majorBoon], ["minorBane", c.item.system.minorBane]
      ].filter(([, v]) => v).map(([k, v]) => ({ label: t(`MODULUS.Field.${k}`), text: v })) : []
    });

    // Dot allocation grid, as on the sheet (§3.2).
    const alloc = plan.allocation;
    const dots = computeDots(alloc);
    const grid = DOMAINS.map((d) => ({
      domain: d, label: t(`MODULUS.Domain.${d}`), chosen: alloc.domain === d,
      cells: EXPRESSIONS.map((e) => {
        const key = statKey(d, e);
        const tier = tierFromDots(dots[key]);
        return {
          key, label: t(`MODULUS.Stat.${d}_${e}`), dots: [0, 1].map((i) => i < dots[key]), tier, tierLabel: t(`MODULUS.Tier.${tier}`),
          intersection: alloc.domain === d && alloc.expression === e, freeDot: alloc.freeDot === key
        };
      })
    }));

    const steps = this.steps;
    const index = steps.indexOf(this.step);
    const wordLimit = getSetting("creation.startingWords");
    const names = (type) => plan[type].map((u) => this.catalog[type].find((c) => c.uuid === u)?.name).filter(Boolean);
    return {
      actorName: this.actor.name,
      steps: steps.map((s) => ({ id: s, label: t(`MODULUS.Creation.Step.${s}`), active: s === this.step, problem: stepErrors[s].length > 0 && s !== "review" })),
      step: this.step,
      isStep: Object.fromEntries(STEPS.map((s) => [s, s === this.step])),
      hasBack: index > 0,
      hasNext: index < steps.length - 1,
      errors: stepErrors[this.step],
      grid,
      expressions: EXPRESSIONS.map((e) => ({ expression: e, label: t(`MODULUS.Expression.${e}`), chosen: alloc.expression === e })),
      shape: shapeSummary(alloc),
      ancestries: this.catalog.ancestry.map((c) => entry("ancestry", c)),
      societies: this.catalog.society.map((c) => entry("society", c)),
      backgroundGroups: CATEGORIES.map((cat) => ({
        category: cat,
        label: t(`MODULUS.Background.${cat}`),
        required: REQUIRED_BACKGROUNDS.includes(cat),
        entries: this.catalog.background.filter((b) => b.category === cat).map((c) => entry("background", c))
      })).filter((g) => g.entries.length || g.required),
      words: this.catalog.word.map((c) => entry("word", c)),
      wordLimit,
      wordCount: plan.word.length,
      review: {
        ancestry: this.catalog.ancestry.find((c) => c.uuid === plan.ancestry)?.name ?? "—",
        societies: names("society").join(", ") || "—",
        backgrounds: names("background").join(", ") || "—",
        words: names("word").join(", ") || "—",
        shape: shapeSummary(alloc),
        lines: check.lines.filter((l) => l.cost > 0),
        cost: check.cost,
        xp: creationXP(this.actor),
        left: creationXP(this.actor) - check.cost
      },
      valid: check.valid,
      rerun: isCreated(this.actor)
    };
  }

  /* ---------------- Steps ---------------- */

  #go(delta) {
    const steps = this.steps;
    const i = Math.min(steps.length - 1, Math.max(0, steps.indexOf(this.step) + delta));
    this.step = steps[i];
    this.render();
  }

  static #onStep(event, target) {
    this.step = target.dataset.step;
    this.render();
  }

  static #onNext() {
    this.#go(1);
  }

  static #onBack() {
    this.#go(-1);
  }

  /* ---------------- Stats (§3.2) ---------------- */

  static #onPickDomain(event, target) {
    const a = this.plan.allocation;
    a.domain = target.dataset.domain;
    if (a.freeDot === statKey(a.domain, a.expression || "x")) a.freeDot = "";
    this.render();
  }

  static #onPickExpression(event, target) {
    const a = this.plan.allocation;
    a.expression = target.dataset.expression;
    if (a.domain && a.freeDot === statKey(a.domain, a.expression)) a.freeDot = "";
    this.render();
  }

  static #onPickFreeDot(event, target) {
    const a = this.plan.allocation;
    const key = target.dataset.stat;
    if (a.domain && a.expression && key === statKey(a.domain, a.expression)) {
      ui.notifications.warn("MODULUS.Allocation.Error.FreeDotOnIntersection", { localize: true });
      return;
    }
    a.freeDot = a.freeDot === key ? "" : key;
    this.render();
  }

  /* ---------------- Picks (§3.7) ---------------- */

  static #onPickAncestry(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    this.plan.ancestry = this.plan.ancestry === uuid ? null : uuid;
    this.render();
  }

  static #onTogglePick(event, target) {
    const type = target.closest("[data-type]").dataset.type;
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const list = this.plan[type];
    const i = list.indexOf(uuid);
    if (i >= 0) list.splice(i, 1);
    else {
      if (type === "word" && list.length >= getSetting("creation.startingWords")) {
        ui.notifications.warn(game.i18n.format("MODULUS.Creation.Error.tooManyWords", { have: list.length + 1, max: getSetting("creation.startingWords") }));
        return;
      }
      list.push(uuid);
    }
    this.render();
  }

  static async #onOpenEntry(event, target) {
    const item = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    item?.sheet.render(true);
  }

  static async #onFinish() {
    if (!this.actor.isOwner || (isCreated(this.actor) && !game.user.isGM)) return;
    const ok = await finishCreation(this.actor, this.plan, this.catalog);
    if (ok) {
      ui.notifications.info(game.i18n.format("MODULUS.Creation.Done", { name: this.actor.name }));
      this.close();
    }
  }
}
