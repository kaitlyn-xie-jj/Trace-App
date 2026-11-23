/**
 * Portable, lossless *export* of Trace's existing Scene records.
 *
 * This is intentionally not an import/migration feature. Keep full image data
 * and existing item metadata; do not silently drop fields.
 */
export function makeSceneExport(scenes, categories, exportedAt = new Date().toISOString()) {
  if (!Array.isArray(scenes) || !Array.isArray(categories)) {
    throw new TypeError('Cannot export without complete scenes and categories');
  }
  if (!scenes.every(scene => scene && typeof scene === 'object' &&
      typeof scene.id === 'string' && Array.isArray(scene.items))) {
    throw new TypeError('One or more scenes are invalid');
  }
  if (!categories.every(name => typeof name === 'string')) {
    throw new TypeError('Category list is invalid');
  }
  if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) {
    throw new TypeError('Invalid export timestamp');
  }

  return {
    format: 'trace-scenes-export',
    formatVersion: 1,
    exportedAt,
    notice: 'Contains sensitive locations and full photographs. Keep private. Trace does not yet support one-click import.',
    categories: [...categories],
    scenes: scenes.map(scene => ({ ...scene, items: scene.items.map(item => ({ ...item })) }))
  };
}

export function serializeSceneExport(scenes, categories, exportedAt) {
  // JSON.stringify reproduces ordinary API JSON values, including base64 photos.
  return JSON.stringify(makeSceneExport(scenes, categories, exportedAt), null, 2);
}
