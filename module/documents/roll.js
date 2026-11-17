import { keepFromFaces, diceCount, isHit } from "../rules/dice.js";
import { SYSTEM_ID } from "../config.js";

/**
 * A Modulus roll: (3 + buff + debuff)d20, one die kept by tier (§13).
 * Dice are rolled through Foundry's Roll so dice-animation modules work, then the
 * faces are passed through the pure keep function and non-kept dice are marked
 * discarded so they render struck through.
 *
 * All Modulus context lives in `options.modulus`, so it survives serialization.
 */
export class ModulusRoll extends foundry.dice.Roll {
  static CHAT_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/roll-card.hbs`;

  /**
   * @param {object} m
   * @param {string} m.tier         effective tier
   * @param {number} m.buff         total buff dice
   * @param {number} m.debuff       total debuff dice
   * @param {number} [m.flatBonus]  gated flat bonus (§2.5)
   * @param {number|null} [m.dc]
   * @param {object} [m.context]    display info: stat, tier breakdown, dc source, label
   */
  static create({ tier, buff = 0, debuff = 0, flatBonus = 0, dc = null, context = {} }) {
    const n = diceCount(buff, debuff);
    return new this(`${n}d20`, {}, { modulus: { tier, buff, debuff, flatBonus, dc, context } });
  }

  get modulus() {
    return this.options.modulus;
  }

  async _evaluate(options = {}) {
    await super._evaluate(options);
    const m = this.modulus;
    const die = this.dice[0];
    const faces = die.results.map((r) => r.result);
    const keep = keepFromFaces(faces, m);
    die.results.forEach((r, i) => {
      const kept = i === keep.keptIndex;
      r.active = kept;
      r.discarded = !kept;
    });
    m.kept = keep.kept;
    m.sorted = keep.sorted;
    m.kept3 = keep.kept3;
    m.total = keep.kept + (m.flatBonus || 0);
    m.hit = m.dc == null ? null : isHit(m.total, m.dc);
    this._total = m.total;
    return this;
  }

  /** Total is the kept die plus gated flat bonus, never the sum of all dice. */
  _evaluateTotal() {
    const m = this.modulus;
    if (m?.kept != null) return m.total;
    return super._evaluateTotal();
  }

  /** Render the Modulus chat card instead of the default roll HTML. */
  async render({ flavor, template = this.constructor.CHAT_TEMPLATE, isPrivate = false } = {}) {
    if (!this._evaluated) await this.evaluate();
    const m = this.modulus;
    const die = this.dice[0];
    const dice = die.results.map((r) => ({
      value: r.result,
      kept: r.active,
      max: r.result === 20,
      min: r.result === 1
    }));
    return foundry.applications.handlebars.renderTemplate(template, {
      isPrivate,
      flavor,
      m,
      dice,
      ctx: m.context ?? {},
      outcome: m.hit == null ? null : m.hit ? "hit" : "miss"
    });
  }
}
