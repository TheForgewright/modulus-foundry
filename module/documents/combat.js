/**
 * Encounter instances (§7.1, §12). A Combat holds the stack state; each Combatant holds its
 * encounter-scoped momentum, scene track and participation. Several instances can run at
 * once: always address them by id, never through `game.combat`.
 */
import { SYSTEM_ID } from "../config.js";
import { newEncounterState } from "../rules/encounter.js";
import { parseLabels, roomEntryMomentum } from "../rules/extended.js";
import { getSetting } from "../settings.js";
import { relationshipsOf } from "../encounter/lookup.js";

export { combatantOf, encountersOf, relationshipsOf } from "../encounter/lookup.js";

export const ENCOUNTER_KINDS = Object.freeze(["standard", "relationship", "investigation", "ordeal"]);

export class ModulusCombat extends Combat {
  /**
   * The pure engine state. Stored as JSON text so every save replaces it wholesale
   * (Foundry merges nested objects on update, which would keep stale keys).
   */
  get encounterState() {
    const raw = this.getFlag(SYSTEM_ID, "state");
    if (!raw) return newEncounterState();
    try {
      return JSON.parse(raw);
    } catch {
      return newEncounterState();
    }
  }

  async saveEncounterState(state) {
    return this.update({ [`flags.${SYSTEM_ID}.state`]: JSON.stringify(state), round: state.round });
  }

  get kind() {
    return this.getFlag(SYSTEM_ID, "kind") ?? "standard";
  }

  get persistent() {
    return Boolean(this.getFlag(SYSTEM_ID, "persistent"));
  }

  get scale() {
    return this.getFlag(SYSTEM_ID, "scale") ?? "";
  }

  get parentId() {
    return this.getFlag(SYSTEM_ID, "parentId") ?? null;
  }

  /** GM labels that tell encounters apart ("court", "Act 2"). */
  get labels() {
    return parseLabels(this.getFlag(SYSTEM_ID, "labels") ?? []);
  }

  /** A closed extended encounter keeps its momentum and history but leaves the open lists (§7.11). */
  get closed() {
    return Boolean(this.getFlag(SYSTEM_ID, "closed"));
  }

  get outcomeNote() {
    return this.getFlag(SYSTEM_ID, "outcome") ?? "";
  }

  get label() {
    return this.name || game.i18n.format("MODULUS.Encounter.Untitled", { n: game.combats.contents.indexOf(this) + 1 });
  }

  /** The sidebar tracker's round controls run the Modulus round flow (§14: the tracker stays secondary). */
  async nextRound() {
    const { encounterController } = await import("../encounter/controller.js");
    await encounterController(this).startRound();
    return this;
  }

  async nextTurn() {
    return this.nextRound();
  }
}

export class ModulusCombatant extends Combatant {
  /** Encounter momentum (§5.2): starts at the actor's starting momentum. */
  get momentum() {
    const m = this.getFlag(SYSTEM_ID, "momentum");
    return Number.isFinite(m) ? m : (this.actor?.system.momentum.starting ?? 3);
  }

  get sceneTrack() {
    return this.getFlag(SYSTEM_ID, "sceneTrack") ?? "";
  }

  /** Taking part this round (§7.3 step 2). Defaults to yes. */
  get participating() {
    return this.getFlag(SYSTEM_ID, "active") !== false;
  }

  get team() {
    return this.getFlag(SYSTEM_ID, "team") ?? "";
  }

  /** Online non-GM owners, the character's player first. */
  get playerOwners() {
    if (!this.actor) return [];
    return game.users
      .filter((u) => u.active && !u.isGM && this.actor.testUserPermission(u, "OWNER"))
      .sort((a, b) => (b.character?.id === this.actor.id) - (a.character?.id === this.actor.id));
  }

  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (!Number.isFinite(this.getFlag(SYSTEM_ID, "momentum"))) {
      const start = this.entryMomentum().value;
      this.updateSource({ [`flags.${SYSTEM_ID}.momentum`]: start, initiative: start });
    }
  }

  /**
   * Momentum on joining (§5, §7.11, OPEN #25). In a short encounter (a room) with the room-entry
   * setting on, a character brings the highest momentum of their open relationships with
   * someone already there, capped at their ceiling. Otherwise their starting momentum.
   */
  entryMomentum() {
    const actor = this.actor;
    const starting = actor?.system.momentum.starting ?? 3;
    const combat = this.parent;
    if (!actor || !combat || combat.persistent || combat.kind !== "standard" || getSetting("roomEntryMomentum") !== "highestCapped") {
      return { value: starting, from: null };
    }
    const present = combat.combatants.filter((c) => c !== this && c.actorId && c.actorId !== actor.id).map((c) => c.actorId);
    return roomEntryMomentum({
      starting,
      ceiling: actor.system.momentum.ceiling,
      relationships: relationshipsOf(actor, { except: combat.id }),
      present
    });
  }

  /**
   * Set encounter momentum. GMs and owners write directly; otherwise ask the active GM.
   * The tracker's initiative mirrors momentum so the sidebar sorts sensibly.
   */
  async setMomentum(value) {
    const v = Math.trunc(Number(value) || 0);
    const update = { [`flags.${SYSTEM_ID}.momentum`]: v, initiative: v };
    if (game.user.isGM || this.isOwner) {
      try {
        return await this.update(update);
      } catch (err) {
        if (game.user.isGM) throw err;
      }
    }
    return game.users.activeGM?.query(`${SYSTEM_ID}.setMomentum`, { combatId: this.parent.id, combatantId: this.id, value: v });
  }

  async adjustMomentum(delta) {
    if (!delta) return;
    return this.setMomentum(this.momentum + delta);
  }
}
