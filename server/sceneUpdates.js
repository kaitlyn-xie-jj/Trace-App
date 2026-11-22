/**
 * Apply PATCH-like scene updates to the existing SQLite row without silently
 * ignoring intentionally cleared fields (e.g. moving a scene to Uncategorized).
 * No schema change; preserves legacy Scene JSON storage.
 */
export function prepareSceneUpdate(existing, updates) {
  if (!existing || typeof existing !== 'object' || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new TypeError('scene and updates must be objects');
  }
  const pick = key => Object.prototype.hasOwnProperty.call(updates, key) ? updates[key] : existing[key];
  const items = pick('items');
  if (items !== undefined && items !== null && !Array.isArray(items) && typeof items !== 'string') {
    throw new TypeError('items must be an array or serialized JSON array');
  }
  let itemsStr;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      if (!Array.isArray(parsed)) throw new TypeError('items must be an array');
      itemsStr = items;
    } catch {
      throw new TypeError('items must be a valid JSON array');
    }
  } else if (Array.isArray(items)) {
    itemsStr = JSON.stringify(items);
  } else {
    itemsStr = existing.items;
  }
  const timestamp = pick('timestamp');
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('timestamp must be nonnegative');
  const locationCategory = pick('locationCategory');
  if (typeof locationCategory !== 'string' || !locationCategory.trim()) {
    throw new TypeError('locationCategory is required');
  }
  const superCategory = pick('superCategory');
  if (superCategory != null && typeof superCategory !== 'string') {
    throw new TypeError('superCategory must be a string or null');
  }
  const fullImageUrl = pick('fullImageUrl');
  if (fullImageUrl != null && typeof fullImageUrl !== 'string') {
    throw new TypeError('fullImageUrl must be a string or null');
  }
  return [
    fullImageUrl ?? null,
    timestamp,
    locationCategory,
    superCategory || null,
    itemsStr
  ];
}
