/**
 * Modulus game system entry point.
 */
import { SYSTEM_ID, MODULUS } from "./config.js";
import { registerSettings } from "./settings.js";
import { CharacterData, NPCData } from "./data/actor.js";
import { ITEM_MODELS } from "./data/item.js";
import { ModulusActor } from "./documents/actor.js";
import { ModulusItem } from "./documents/item.js";
import { ModulusRoll } from "./documents/roll.js";
import { ModulusActorSheet } from "./apps/actor-sheet.js";
import { ModulusItemSheet } from "./apps/item-sheet.js";
import { openRollDialog, buildRollPlan, rollFromPlan } from "./apps/roll-dialog.js";
import * as rules from "./rules/index.js";

Hooks.once("init", () => {
  console.log("Modulus | Initializing");
  CONFIG.MODULUS = MODULUS;

  registerSettings();

  CONFIG.Actor.documentClass = ModulusActor;
  CONFIG.Item.documentClass = ModulusItem;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, npc: NPCData });
  Object.assign(CONFIG.Item.dataModels, ITEM_MODELS);
  CONFIG.Dice.rolls.unshift(ModulusRoll);

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, ModulusActorSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "MODULUS.Sheet.Actor"
  });
  DocumentSheetConfig.registerSheet(Item, SYSTEM_ID, ModulusItemSheet, {
    makeDefault: true,
    label: "MODULUS.Sheet.Item"
  });

  foundry.applications.handlebars.loadTemplates([
    `systems/${SYSTEM_ID}/templates/actor/header.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/nav.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/main.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/items.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/notes.hbs`,
    `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/roll-card.hbs`,
    `systems/${SYSTEM_ID}/templates/dialog/roll-dialog.hbs`
  ]);

  // Public API for macros and add-ons.
  game.modulus = { rules, openRollDialog, buildRollPlan, rollFromPlan, ModulusRoll };
});
