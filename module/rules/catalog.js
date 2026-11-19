/**
 * Merging world content with the system's compendium content. Pure JS, no Foundry imports.
 *
 * Compendium entries are used directly (not copied into worlds). A world Item overrides the compendium
 * entry it was made from (its compendium source), so a GM can change an entry for one world.
 */

/**
 * @param {Array<{uuid, sourceUuid?}>} world     world Items; sourceUuid = the compendium entry they came from
 * @param {Array<{uuid}>} compendium              compendium entries
 * @returns {Array} world Items, then compendium entries no world Item overrides
 */
export function mergeCatalog(world, compendium) {
  const overridden = new Set(world.map((w) => w.sourceUuid).filter(Boolean));
  return [...world, ...compendium.filter((c) => !overridden.has(c.uuid))];
}
