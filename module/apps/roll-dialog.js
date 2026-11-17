/**
 * Manual roll dialog (§13): stat picker, buff/debuff counters, optional gated flat
 * bonus, DC mode (target actor + stat, manual number, or none).
 */
import { SYSTEM_ID } from "../config.js";
import { STAT_KEYS } from "../rules/constants.js";
import { hitChance } from "../rules/dice.js";
import { ModulusRoll } from "../documents/roll.js";
import { getSetting } from "../settings.js";
import { statChoices } from "../data/fields.js";

const { DialogV2 } = foundry.applications.api;
const TEMPLATE = `systems/${SYSTEM_ID}/templates/dialog/roll-dialog.hbs`;

function firstTarget() {
  const token = game.user.targets.first();
  return token?.actor ?? null;
}

/**
 * Compute every number that goes into a roll. Shared by the live preview and the roll itself.
 */
export function buildRollPlan(actor, { statKey, buff = 0, debuff = 0, flatBonus = 0, dcMode = "manual", dc, targetStat }, target = firstTarget()) {
  const eff = actor.getEffectiveTier(statKey);
  const plan = {
    statKey,
    statLabel: game.i18n.localize(`MODULUS.Stat.${statKey.replace(".", "_")}`),
    baseTier: eff.baseTier,
    tier: eff.tier,
    defeatedTracks: eff.defeatedTracks,
    buffInput: buff,
    debuffInput: debuff,
    buff: buff + eff.extraBuffDice,
    debuff: debuff + eff.extraDebuffDice,
    extraDebuff: eff.extraDebuffDice,
    extraBuff: eff.extraBuffDice,
    flatBonus,
    dc: null,
    dcSource: null
  };
  if (dcMode === "manual" && Number.isFinite(dc)) {
    plan.dc = dc;
    plan.dcSource = { kind: "manual" };
  } else if (dcMode === "target" && target && targetStat) {
    const def = target.getDefenseDC(targetStat);
    plan.dc = def.dc;
    plan.dcSource = {
      kind: "target",
      targetName: target.name,
      stat: targetStat,
      statLabel: game.i18n.localize(`MODULUS.Stat.${targetStat.replace(".", "_")}`),
      tier: def.tier,
      baseTier: def.baseTier,
      defeatedTracks: def.defeatedTracks,
      extraDebuff: def.extraDebuffDice
    };
  }
  plan.chance = plan.dc == null ? null : hitChance({ tier: plan.tier, buff: plan.buff, debuff: plan.debuff, dc: plan.dc, flatBonus });
  return plan;
}

export async function rollFromPlan(actor, plan, { label } = {}) {
  const roll = ModulusRoll.create({
    tier: plan.tier,
    buff: plan.buff,
    debuff: plan.debuff,
    flatBonus: plan.flatBonus,
    dc: plan.dc,
    context: {
      label: label ?? plan.statLabel,
      actorName: actor.name,
      statKey: plan.statKey,
      statLabel: plan.statLabel,
      baseTier: plan.baseTier,
      tier: plan.tier,
      defeatedTracks: plan.defeatedTracks,
      extraDebuff: plan.extraDebuff,
      extraBuff: plan.extraBuff,
      buffInput: plan.buffInput,
      debuffInput: plan.debuffInput,
      dcSource: plan.dcSource
    }
  });
  await roll.evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  return roll;
}

function readForm(form) {
  const data = new foundry.applications.ux.FormDataExtended(form).object;
  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return {
    statKey: data.statKey,
    buff: int(data.buff),
    debuff: int(data.debuff),
    flatBonus: Math.floor(Number(data.flatBonus) || 0),
    dcMode: data.dcMode,
    dc: data.dc === "" || data.dc == null ? NaN : Number(data.dc),
    targetStat: data.targetStat
  };
}

function renderPreview(actor, form) {
  const plan = buildRollPlan(actor, readForm(form));
  const el = form.querySelector(".modulus-roll-preview");
  if (!el) return;
  const t = (k) => game.i18n.localize(k);
  const parts = [
    `${3 + plan.buff + plan.debuff}d20`,
    `${t("MODULUS.Roll.Keep")}: ${t(`MODULUS.Tier.${plan.tier}`)}`
  ];
  if (plan.extraDebuff) parts.push(game.i18n.format("MODULUS.Roll.DegradeDice", { n: plan.extraDebuff }));
  if (plan.dc != null) parts.push(`DC ${plan.dc}`, `${(plan.chance * 100).toFixed(1)}%`);
  el.textContent = parts.join(" · ");
}

/**
 * Open the manual roll dialog for an actor.
 * @param {Actor} actor
 * @param {object} [defaults]
 */
export async function openRollDialog(actor, defaults = {}) {
  const target = firstTarget();
  const context = {
    stats: statChoices(),
    statKey: defaults.statKey ?? STAT_KEYS[0],
    buff: defaults.buff ?? 0,
    debuff: defaults.debuff ?? 0,
    flatBonus: defaults.flatBonus ?? 0,
    dc: defaults.dc ?? getSetting("defaultTaskDC"),
    dcMode: defaults.dcMode ?? (target ? "target" : "manual"),
    targetStat: defaults.targetStat ?? defaults.statKey ?? STAT_KEYS[0],
    targetName: target?.name ?? null,
    dcModes: {
      manual: "MODULUS.Roll.DCMode.manual",
      target: "MODULUS.Roll.DCMode.target",
      none: "MODULUS.Roll.DCMode.none"
    }
  };
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, context);
  const result = await DialogV2.wait({
    window: { title: game.i18n.format("MODULUS.Roll.Title", { name: actor.name }) },
    classes: ["modulus", "modulus-roll-dialog"],
    content,
    rejectClose: false,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      if (!form) return;
      form.addEventListener("change", () => renderPreview(actor, form));
      form.addEventListener("input", () => renderPreview(actor, form));
      renderPreview(actor, form);
    },
    buttons: [
      {
        action: "roll",
        label: "MODULUS.Roll.Roll",
        icon: "fa-solid fa-dice-d20",
        default: true,
        callback: (event, button) => readForm(button.form)
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  });
  if (!result || typeof result !== "object") return null;
  const plan = buildRollPlan(actor, result, target);
  return rollFromPlan(actor, plan);
}
