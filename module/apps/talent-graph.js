/**
 * Read-only view of the talent prerequisite graph (§15) with its validity check: per domain,
 * tier-1 talents with the tier-2 talents that need them and the tier-3 talents above those.
 */
import { SYSTEM_ID } from "../config.js";
import { talentTree } from "../rules/talents.js";
import { knownTalents, talentIssues, issueText } from "../talents/talents.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TalentGraph extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modulus-talent-graph",
    classes: ["modulus", "talent-graph"],
    window: { title: "MODULUS.Talent.Graph", icon: "fa-solid fa-diagram-project", resizable: true },
    position: { width: 760, height: 640 },
    actions: { openTalent: TalentGraph.#onOpen }
  };

  static PARTS = { body: { template: `systems/${SYSTEM_ID}/templates/apps/talent-graph.hbs`, scrollable: [""] } };

  static open() {
    this._instance ??= new this();
    this._instance.render({ force: true });
    return this._instance;
  }

  async _prepareContext() {
    const known = await knownTalents();
    const tree = talentTree([...known.values()]);
    const issues = await talentIssues();
    const flagged = new Set(issues.map((i) => i.talentId));
    const decorate = (n) => ({ ...n, problem: flagged.has(n.talentId), children: n.children.map(decorate) });
    return {
      domains: Object.entries(tree.domains).map(([d, roots]) => ({ domain: d, label: game.i18n.localize(`MODULUS.Domain.${d}`), roots: roots.map(decorate) })),
      loose: tree.loose.map(decorate),
      issues: issues.map((i) => ({ text: issueText(i), uuid: known.get(i.talentId)?.uuid })),
      count: known.size
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const rerender = foundry.utils.debounce(() => this.rendered && this.render(), 100);
    this._hooks = ["createItem", "updateItem", "deleteItem"].map((h) => [h, Hooks.on(h, (item) => item.type === "talent" && rerender())]);
  }

  _onClose(options) {
    super._onClose(options);
    for (const [h, id] of this._hooks ?? []) Hooks.off(h, id);
  }

  static async #onOpen(event, target) {
    const item = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    item?.sheet.render(true);
  }
}
