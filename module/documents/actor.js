import {
  createDeckState, drawCards, burnCards, discardCards, blackjackValue, useHand, evaluateHand, HAND_NAMES
} from "../rules/deck.js";
import { deckModifiers, cardAbilities } from "../deck/card-effects.js";
import { SYSTEM_ID } from "../config.js";
import { DOMAINS, parseStatKey } from "../rules/constants.js";
import { effectiveTier, dcForTier } from "../rules/tier.js";
import { applyPips, shortRest, longRest } from "../rules/tracks.js";
import { dcTable, getSetting } from "../settings.js";

export class ModulusActor extends Actor {
  /** Base tier of a stat, before degradation and shifts. */
  getBaseTier(key) {
    const { domain, expression } = parseStatKey(key);
    return this.system.stats[domain][expression].tier;
  }

  /**
   * §3.3 effective tier, shared by rolling and defense.
   * Conditional-effect tier shifts (§8.1) are added in Phase 4.
   * @param {string} key
   * @param {{defense?: boolean, shifts?: number[]}} [opts]
   */
  getEffectiveTier(key, { defense = false, shifts = [] } = {}) {
    const defeatedTracks = defense && !getSetting("defeatAffectsDefense") ? 0 : this.system.defeatedTracks;
    const result = effectiveTier({
      baseTier: this.getBaseTier(key),
      defeatedTracks,
      shifts,
      aboveRank: getSetting("condFx.aboveRank")
    });
    result.baseTier = this.getBaseTier(key);
    result.defeatedTracks = defeatedTracks;
    return result;
  }

  /** Defense DC when this actor is the target of an action testing `key` (§2.3). */
  getDefenseDC(key) {
    const eff = this.getEffectiveTier(key, { defense: true });
    return { dc: dcForTier(eff.tier, dcTable()), ...eff };
  }

  /**
   * Apply damage (positive) or healing (negative) to one track.
   * Overflow (§4.4) is reported, not auto-spent: the player chooses where it goes.
   */
  async applyPips(domain, amount) {
    const track = this.system.tracks[domain];
    const r = applyPips({ pipsLost: track.pipsLost, amount, max: track.max, perLevel: track.perLevel });
    const update = { [`system.tracks.${domain}.pipsLost`]: r.pipsLost };
    // A fresh change to the track re-arms the defeat status.
    if (r.pipsLost !== track.pipsLost) update[`system.tracks.${domain}.defeatCleared`] = false;
    await this.update(update);
    if (r.overflow > 0) {
      ui.notifications.info(game.i18n.format("MODULUS.Tracks.Overflow", { name: this.name, amount: r.overflow, track: game.i18n.localize(`MODULUS.Domain.${domain}`) }));
    }
    if (r.breakPointsCrossed > 0) {
      ui.notifications.info(game.i18n.format("MODULUS.Tracks.BreakPoint", { name: this.name, track: game.i18n.localize(`MODULUS.Domain.${domain}`) }));
    }
    return r;
  }

  async rest(kind) {
    const fn = kind === "long" ? longRest : shortRest;
    const update = {};
    for (const d of DOMAINS) {
      const t = this.system.tracks[d];
      const next = fn(t.pipsLost, t.perLevel);
      if (next !== t.pipsLost) {
        update[`system.tracks.${d}.pipsLost`] = next;
        update[`system.tracks.${d}.defeatCleared`] = false;
      }
    }
    if (Object.keys(update).length) await this.update(update);
  }

  async clearDefeat(domain) {
    await this.update({ [`system.tracks.${domain}.defeatCleared`]: true });
  }
}

/* -------------------------------------------- */
/*  Personal card deck (§10)                     */
/* -------------------------------------------- */


export const STANDALONE_DECK = "standalone";

const rng = () => CONFIG.Dice.randomUniform();

Object.assign(ModulusActor.prototype, {
  /** All decks this actor holds, keyed by encounter (Combat) id. */
  getDecks() {
    return this.getFlag(SYSTEM_ID, "decks") ?? {};
  },

  getDeck(encounterId) {
    return this.getDecks()[encounterId] ?? null;
  },

  /** The deck to show by default: the viewed combat's, else any. */
  defaultDeckId() {
    const decks = this.getDecks();
    const current = game.combat?.id;
    if (current && decks[current]) return current;
    return Object.keys(decks)[0] ?? null;
  },

  async saveDeck(encounterId, state) {
    // Piles are arrays, which an update replaces wholesale, so a plain setFlag is safe.
    return this.setFlag(SYSTEM_ID, `decks.${encounterId}`, state);
  },

  /** Build a fresh deck from the 52 standard cards plus this actor's composition effects, shuffled once. */
  async createDeck(encounterId = STANDALONE_DECK) {
    const state = createDeckState(deckModifiers(this), rng);
    state.pendingMomentumLoss = 0;
    state.createdAt = Date.now();
    await this.saveDeck(encounterId, state);
    return state;
  },

  async deleteDeck(encounterId) {
    return this.unsetFlag(SYSTEM_ID, `decks.${encounterId}`);
  },

  async drawCards(count = 1, encounterId = this.defaultDeckId()) {
    const deck = this.getDeck(encounterId);
    if (!deck) throw new Error(`${this.name} has no deck for encounter ${encounterId}`);
    const r = drawCards(deck, count, rng);
    await this.saveDeck(encounterId, r.state);
    const parts = [game.i18n.format("MODULUS.Deck.Chat.Drew", { name: this.name, n: r.drawn.length, left: r.state.draw.length })];
    if (r.reshuffled) parts.push(game.i18n.localize("MODULUS.Deck.Chat.Reshuffled"));
    if (r.short) parts.push(game.i18n.format("MODULUS.Deck.Chat.Short", { n: r.short }));
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${parts.join(" ")}</p>` });
    return r;
  },

  async burnCards(ids, encounterId = this.defaultDeckId()) {
    const deck = this.getDeck(encounterId);
    const names = deck.hand.filter((c) => ids.includes(c.id)).map((c) => c.id);
    await this.saveDeck(encounterId, burnCards(deck, ids));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("MODULUS.Deck.Chat.Burned", { name: this.name, cards: names.join(", ") })}</p>`
    });
  },

  /** §10: discard a card for its blackjack value in momentum now; lose the same at the start of next round. */
  async discardForMomentum(cardId, { aceHigh = false } = {}, encounterId = this.defaultDeckId()) {
    const deck = this.getDeck(encounterId);
    const card = deck.hand.find((c) => c.id === cardId);
    const value = card ? blackjackValue(card, { aceHigh }) : null;
    if (value == null) {
      ui.notifications.warn("MODULUS.Deck.NoBlackjackValue", { localize: true });
      return null;
    }
    const state = discardCards(deck, [cardId]);
    state.pendingMomentumLoss = (deck.pendingMomentumLoss ?? 0) + value;
    await this.saveDeck(encounterId, state);
    await this.update({ "system.momentum.current": this.system.momentum.current + value });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("MODULUS.Deck.Chat.DiscardMomentum", { name: this.name, card: card.id, n: value })}</p>`
    });
    return value;
  },

  async settleMomentumLoss(encounterId) {
    const deck = this.getDeck(encounterId);
    const loss = deck?.pendingMomentumLoss ?? 0;
    if (!loss) return;
    await this.saveDeck(encounterId, { ...deck, pendingMomentumLoss: 0 });
    await this.update({ "system.momentum.current": this.system.momentum.current - loss });
  },

  /**
   * Use a poker-hand ability: evaluate the selected cards, check the requirement,
   * consume cards per the effect, and post the result.
   * @returns {Promise<object>} the useHand result
   */
  async useCardAbility(itemId, effectIndex, selectedIds, encounterId = this.defaultDeckId()) {
    const deck = this.getDeck(encounterId);
    const ability = cardAbilities(this).find((a) => a.item.id === itemId && a.index === effectIndex);
    if (!deck || !ability) throw new Error("Unknown deck or ability");
    const r = useHand(deck, selectedIds, ability.req);
    if (!r.ok) {
      ui.notifications.warn(game.i18n.format(`MODULUS.Deck.Fail.${r.reason}`, { min: game.i18n.localize(`MODULUS.Hand.${HAND_NAMES[ability.req.minRank ?? 0]}`) }));
      return r;
    }
    if (r.state !== deck) await this.saveDeck(encounterId, r.state);
    const grant = { ...(ability.req.grant ?? {}), ...(r.grant ?? {}) };
    delete grant.minRank;
    const content = await foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/chat/hand-card.hbs`, {
      actor: this.name,
      ability: ability.label,
      hand: r.hand,
      handName: game.i18n.localize(`MODULUS.Hand.${r.hand.name}`),
      cards: r.hand.cards.map(cardView),
      consume: ability.req.consume ?? "selected",
      grant: Object.entries(grant).map(([k, v]) => ({ key: k, value: v }))
    });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content });
    return { ...r, grant };
  }
});

const SUIT_GLYPH = { c: "♣", d: "♦", h: "♥", s: "♠", x: "★" };
const RANK_LABEL = { 0: "JKR", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

/** Display data for a card. */
export function cardView(card) {
  return {
    id: card.id,
    rank: RANK_LABEL[card.rank] ?? String(card.rank),
    suit: SUIT_GLYPH[card.suit],
    red: card.suit === "d" || card.suit === "h",
    joker: card.rank === 0
  };
}

