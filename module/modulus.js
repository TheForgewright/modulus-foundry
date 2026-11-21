/**
 * Modulus game system entry point.
 */
import { SYSTEM_ID, MODULUS } from "./config.js";
import { registerSettings } from "./settings.js";
import { CharacterData, NPCData, SubjectData } from "./data/actor.js";
import { ITEM_MODELS } from "./data/item.js";
import { ModulusActor } from "./documents/actor.js";
import { ModulusItem } from "./documents/item.js";
import { ModulusRoll } from "./documents/roll.js";
import { ModulusActorSheet } from "./apps/actor-sheet.js";
import { ModulusItemSheet } from "./apps/item-sheet.js";
import { SubjectSheet } from "./apps/subject-sheet.js";
import { openRollDialog, buildRollPlan, rollFromPlan } from "./apps/roll-dialog.js";
import * as rules from "./rules/index.js";
import { registerDeckHooks } from "./deck/lifecycle.js";
import { VocabularyEditor } from "./apps/vocab-editor.js";
import { ActionBuilder, openActionBuilder, buildDeclaration, resolveDeclaration } from "./apps/action-builder.js";
import { ModulusCombat, ModulusCombatant } from "./documents/combat.js";
import { EncounterManager } from "./apps/encounter-manager.js";
import { encounterController } from "./encounter/controller.js";
import { registerQueries } from "./encounter/queries.js";
import { decorateChatMessage } from "./encounter/outcomes.js";
import { registerSyncHooks, openSyncDialog, syncCompendiumCopies, syncPlan } from "./compendium/sync.js";
import { registerEncounterEvents, requestEmit } from "./encounter/events.js";
import { registerTalentHooks } from "./talents/talents.js";
import { TalentGraph } from "./apps/talent-graph.js";
import { registerCatalog, loadCatalog, catalogItems } from "./vocab/catalog.js";
import { CharacterCreation } from "./apps/character-creation.js";
import { registerCreationHooks, respec } from "./creation/creation.js";

Hooks.once("init", () => {
  console.log("Modulus | Initializing");
  CONFIG.MODULUS = MODULUS;

  registerSettings();

  CONFIG.Actor.documentClass = ModulusActor;
  CONFIG.Item.documentClass = ModulusItem;
  CONFIG.Combat.documentClass = ModulusCombat;
  CONFIG.Combatant.documentClass = ModulusCombatant;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, npc: NPCData, subject: SubjectData });
  Object.assign(CONFIG.Item.dataModels, ITEM_MODELS);
  CONFIG.Dice.rolls.unshift(ModulusRoll);

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, ModulusActorSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "MODULUS.Sheet.Actor"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, SubjectSheet, {
    types: ["subject"],
    makeDefault: true,
    label: "MODULUS.Sheet.Subject"
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
    `systems/${SYSTEM_ID}/templates/actor/cards.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/talents.hbs`,
    `systems/${SYSTEM_ID}/templates/actor/subject.hbs`,
    `systems/${SYSTEM_ID}/templates/apps/talent-graph.hbs`,
    `systems/${SYSTEM_ID}/templates/apps/character-creation.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/hand-card.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/action-card.hbs`,
    `systems/${SYSTEM_ID}/templates/apps/vocab-editor.hbs`,
    `systems/${SYSTEM_ID}/templates/apps/action-builder.hbs`,
    `systems/${SYSTEM_ID}/templates/apps/encounter-manager.hbs`,
    `systems/${SYSTEM_ID}/templates/item/item-sheet.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/roll-card.hbs`,
    `systems/${SYSTEM_ID}/templates/dialog/roll-dialog.hbs`
  ]);

  registerDeckHooks();
  registerQueries();
  registerSyncHooks();
  registerEncounterEvents();
  registerTalentHooks();
  registerCatalog();
  registerCreationHooks();

  game.settings.registerMenu(SYSTEM_ID, "vocabularyEditor", {
    name: "MODULUS.Vocab.Title",
    label: "MODULUS.Vocab.Open",
    hint: "MODULUS.Vocab.MenuHint",
    icon: "fa-solid fa-book-open",
    type: VocabularyEditor,
    restricted: true
  });

  // Public API for macros and add-ons.
  game.modulus = {
    rules, openRollDialog, buildRollPlan, rollFromPlan, ModulusRoll,
    VocabularyEditor, openVocabularyEditor: () => VocabularyEditor.open(),
    ActionBuilder, openActionBuilder, buildDeclaration, resolveDeclaration,
    EncounterManager, openEncounterManager: (combatId) => EncounterManager.open(combatId), encounterController,
    syncCompendiums: openSyncDialog, syncCompendiumCopies, syncPlan,
    emitEvent: requestEmit,
    openTalentGraph: () => TalentGraph.open(),
    catalogItems, reloadCatalog: loadCatalog,
    CharacterCreation, openCharacterCreation: (actor) => CharacterCreation.open(actor), respec
  };
});

// Vocabulary Editor button on the Items sidebar (GM only).
Hooks.on("renderItemDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".modulus-vocab-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "modulus-vocab-button";
  button.innerHTML = `<i class="fa-solid fa-book-open"></i> ${game.i18n.localize("MODULUS.Vocab.Title")}`;
  button.addEventListener("click", () => VocabularyEditor.open());
  const actions = root.querySelector(".header-actions") ?? root.querySelector("header") ?? root;
  actions.append(button);
});

// Encounter Manager button on the Combat sidebar.
Hooks.on("renderCombatTracker", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".modulus-em-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "modulus-em-button";
  button.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${game.i18n.localize("MODULUS.Encounter.Manager")}`;
  button.addEventListener("click", () => EncounterManager.open(app.viewed?.id));
  (root.querySelector("header") ?? root).append(button);
});

// Outcome buttons on Modulus chat cards (§7.8).
Hooks.on("renderChatMessageHTML", (message, html) => decorateChatMessage(message, html));
