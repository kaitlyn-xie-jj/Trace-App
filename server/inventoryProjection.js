/**
 * Trace Core v0: non-destructive read projection over legacy Scene rows.
 *
 * The original scenes table remains the sole source of truth. No backfill,
 * schema migration, writes, ownership inference or destructive conversion.
 * A scene record is a photograph, NOT a durable physical-item identity.
 */
const label = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export function projectInventory(scenes) {
  if (!Array.isArray(scenes)) throw new TypeError('scenes must be an array');

  const locationsById = new Map();
  const items = [];
  const warnings = [];

  for (const scene of scenes) {
    if (!scene || typeof scene.id !== 'string') {
      warnings.push({ sceneId: null, code: 'INVALID_SCENE' });
      continue;
    }

    const spaceName = label(scene.superCategory, '未分类空间');
    const locationName = label(scene.locationCategory, '未命名位置');
    const locationId = JSON.stringify([spaceName, locationName]);
    if (!locationsById.has(locationId)) {
      locationsById.set(locationId, {
        id: locationId,
        spaceName,
        name: locationName,
        source: 'legacy-scenes'
      });
    }

    let records = scene.items;
    if (typeof records === 'string') {
      try {
        records = JSON.parse(records || '[]');
      } catch {
        warnings.push({ sceneId: scene.id, code: 'INVALID_ITEMS_JSON' });
        continue;
      }
    }
    if (!Array.isArray(records)) {
      warnings.push({ sceneId: scene.id, code: 'INVALID_ITEMS_ARRAY' });
      continue;
    }

    records.forEach((item, index) => {
      if (!item || typeof item.itemName !== 'string' || !item.itemName.trim()) {
        warnings.push({ sceneId: scene.id, index, code: 'INVALID_ITEM' });
        return;
      }
      items.push({
        id: JSON.stringify([scene.id, index]),
        name: item.itemName.trim(),
        category: typeof item.category === 'string' ? item.category : '',
        locationId,
        sourceSceneId: scene.id,
        sourceIndex: index,
        recordedAt: Number.isFinite(scene.timestamp) ? scene.timestamp : null,
        // These IDs are only stable while the original scene/item ordering stays unchanged.
        identityStatus: 'provisional',
        attributes: {
          remarks: typeof item.remarks === 'string' ? item.remarks : '',
          preciseLocation: typeof item.preciseLocation === 'string' ? item.preciseLocation : '',
          isPerishable: item.isPerishable === true,
          shelfLifeDays: Number.isFinite(item.shelfLifeDays) ? item.shelfLifeDays : null
        }
      });
    });
  }

  return {
    schemaVersion: 1,
    source: 'legacy-scenes',
    ownershipScope: 'unassigned',
    locations: [...locationsById.values()],
    items,
    warnings
  };
}
