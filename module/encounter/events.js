/**
 * Events that happen outside the round flow (§8.1.1), emitted into every encounter the character
 * is in: scene track and momentum changes, pips, break points and defeat, statuses, participants
 * joining or leaving, card plays, rests, and the talents' manual buttons.
 * Document hooks fire on every client; only the active GM emits.
 */
import { SYSTEM_ID } from "../config.js";
import { DOMAINS } from "../rules/constants.js";
import { breakPointEvents, sceneTrackEvent } from "../rules/condfx.js";
import { crossedThresholds, talentThresholds } from "../rules/extended.js";
import { encounterController } from "./controller.js";
import { participantTalents } from "./condfx-bridge.js";
import { combatantOf } from "./lookup.js";
import { getSetting } from "../settings.js";

const isActiveGM = () => game.users.activeGM?.isSelf;
const rid = () => foundry.utils.randomID(8);

/** Combats the actor takes part in, with its combatant in each. */
function encountersOf(actor) {
  const out = [];
  for (const combat of game.combats) {
    if (combat.closed) continue;
    const combatant = combatantOf(combat, actor);
    if (combatant && combat.encounterState.round > 0) out.push({ combat, combatant });
  }
  return out;
}

/** Emit an event for this actor into each of its encounters (GM side). */
export async function emitForActor(actor, event) {
  for (const { combat, combatant } of encountersOf(actor)) {
    const round = combat.encounterState.round;
    const make = typeof event === "function" ? event({ combat, combatant, round }) : event;
    for (const e of [].concat(make).filter(Boolean)) {
      await encounterController(combat).emit({ id: rid(), actorId: combatant.id, ...e });
    }
  }
}

/** From any client: GMs emit directly, players ask the active GM. */
export async function requestEmit(actor, event) {
  if (game.user.isGM) return emitForActor(actor, event);
  return game.users.activeGM?.query(`${SYSTEM_ID}.emitEvent`, { actorUuid: actor.uuid, event });
}

async function emitQuery({ actorUuid, event }, { user }) {
  if (!game.user.isGM) return false;
  const actor = await fromUuid(actorUuid);
  if (!actor?.testUserPermission(user, "OWNER")) return false;
  const allowed = ["cardEvent", "restTaken", "manual"];
  if (!allowed.includes(event?.type)) return false;
  await emitForActor(actor, event);
  return true;
}

/**
 * Momentum thresholds met, in any encounter (running, resting or never started), go to chat:
 * talent thresholds (momentum triggers), dropping below zero (§5.2) and reaching the ceiling.
 */
export function thresholdsMet(combatant, from, to) {
  const combat = combatant.parent;
  return crossedThresholds({
    from, to,
    ceiling: combatant.actor?.system.momentum.ceiling,
    thresholds: talentThresholds(participantTalents(combat), combatant.id, combat.kind)
  });
}

async function postThresholds(combatant, from, to) {
  if (!getSetting("momentum.thresholdChat") || !Number.isFinite(from) || !Number.isFinite(to)) return;
  const met = thresholdsMet(combatant, from, to);
  if (!met.length) return;
  const combat = combatant.parent;
  const esc = foundry.utils.escapeHTML;
  const line = (m) => game.i18n.format(`MODULUS.MomentumThreshold.Met.${m.type}`, { value: m.value, source: esc(m.source ?? "") });
  const labels = combat.labels.length ? ` <span class="hint">${combat.labels.map(esc).join(" · ")}</span>` : "";
  const content = `<div class="modulus-encounter-note modulus-threshold">
    <strong>${esc(combat.label)}</strong> <span class="hint">${esc(game.i18n.localize(`MODULUS.Encounter.Kind.${combat.kind}`))}</span>${labels}
    <p>${esc(game.i18n.format("MODULUS.MomentumThreshold.Moved", { name: combatant.name, from, to }))}</p>
    <ul>${met.map((m) => `<li>${line(m)}</li>`).join("")}</ul></div>`;
  await ChatMessage.create({ content, speaker: { alias: game.i18n.localize("MODULUS.Encounter.Speaker") } });
}

export function registerEncounterEvents() {
  CONFIG.queries[`${SYSTEM_ID}.emitEvent`] = emitQuery;

  // Scene track and momentum, on the combatant.
  Hooks.on("preUpdateCombatant", (c, changes, options) => {
    options.modulusBefore = { sceneTrack: c.sceneTrack, momentum: c.momentum, team: c.team };
  });
  Hooks.on("updateCombatant", (c, changes, options) => {
    if (!isActiveGM() || !options.modulusBefore) return;
    const combat = c.parent;
    const moved = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.momentum`);
    if (moved !== undefined) postThresholds(c, options.modulusBefore.momentum, moved);
    if (combat.closed) return;
    const round = combat.encounterState.round;
    if (round < 1) return;
    const before = options.modulusBefore;
    const events = [];
    const track = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.sceneTrack`);
    if (track !== undefined) events.push(sceneTrackEvent({ from: before.sceneTrack, to: track, actorId: c.id, round, instanceId: combat.id }));
    // Teams (reveals, betrayals, slipping into stealth): from / to labels; "" is free for all.
    const team = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.team`);
    if (team !== undefined && (team ?? "") !== (before.team ?? "")) {
      events.push({ id: rid(), type: "teamChanged", actorId: c.id, params: { from: before.team ?? "", to: team ?? "" } });
    }
    const m = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.momentum`);
    if (m !== undefined && m !== before.momentum) {
      events.push({ id: rid(), type: "momentumCrossed", actorId: c.id, params: { from: before.momentum, to: m } });
      if (combat.kind !== "standard") events.push({ id: rid(), type: "extendedMomentum", actorId: c.id, params: { kind: combat.kind, from: before.momentum, to: m } });
    }
    if (events.some(Boolean)) encounterController(combat).emit(events.filter(Boolean));
  });

  // Pips, break points and defeat, on the actor.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    options.modulusBefore = Object.fromEntries(DOMAINS.map((d) => [d, { lost: actor.system.tracks?.[d]?.pipsLost ?? 0, defeated: actor.system.tracks?.[d]?.defeated ?? false }]));
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    if (!isActiveGM() || !options.modulusBefore) return;
    const before = options.modulusBefore;
    emitForActor(actor, ({ combatant, round, combat }) => {
      const out = [];
      for (const d of DOMAINS) {
        const t = actor.system.tracks?.[d];
        if (!t) continue;
        const was = before[d];
        if (t.pipsLost > was.lost) {
          out.push({ type: "pipsLost", params: { amount: t.pipsLost - was.lost, track: d } });
          out.push(...breakPointEvents({ before: was.lost, after: t.pipsLost, perLevel: t.perLevel, actorId: combatant.id, track: d, round, instanceId: combat.id }).map(({ id, ...e }) => e));
        }
        if (t.defeated && !was.defeated) out.push({ type: "defeatedOnTrack", params: { track: d } });
        if (!t.defeated && was.defeated) out.push({ type: "recoveredOnTrack", params: { track: d } });
      }
      return out;
    });
  });

  // Statuses.
  const statusEvent = (type) => (item) => {
    if (!isActiveGM() || item.type !== "status" || !(item.parent instanceof Actor)) return;
    emitForActor(item.parent, { type, params: { name: item.name, track: item.system.track } });
  };
  Hooks.on("createItem", statusEvent("statusApplied"));
  Hooks.on("deleteItem", statusEvent("statusRemoved"));

  // Participants.
  Hooks.on("createCombatant", (c) => {
    if (!isActiveGM() || !c.parent?.encounterState.round) return;
    encounterController(c.parent).emit([{ id: rid(), type: "participantJoined", actorId: c.id }]);
  });
}
