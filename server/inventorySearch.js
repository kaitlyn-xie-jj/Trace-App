/**
 * Deterministic, zero-LLM retrieval for existing Trace Core inventory records.
 *
 * Results are evidence-linked to the scene that originally recorded the item.
 * This is a conservative lexical search, not a claim of semantic understanding
 * or current physical presence. Callers can fall back to AI on no match.
 */
export function searchInventory(inventory, rawQuery, { limit = 20 } = {}) {
  if (!inventory || !Array.isArray(inventory.items) || !Array.isArray(inventory.locations)) {
    throw new TypeError('invalid inventory projection');
  }
  if (typeof rawQuery !== 'string') throw new TypeError('query must be a string');

  const query = rawQuery.normalize('NFKC').trim().toLocaleLowerCase();
  if (!query || query.length > 200) throw new RangeError('query length must be 1–200 characters');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer from 1 to 100');
  }

  const normalized = value =>
    typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase().trim() : '';
  const locations = new Map(inventory.locations.map(loc => [loc.id, loc]));

  const results = inventory.items.flatMap(item => {
    const location = locations.get(item.locationId);
    const name = normalized(item.name);
    const category = normalized(item.category);
    const note = normalized(item.attributes?.remarks);
    const precise = normalized(item.attributes?.preciseLocation);
    const space = normalized(location?.spaceName);
    const spot = normalized(location?.name);

    // Allow a full-sentence question ("我的护照在哪里") to name a saved item.
    // Do not use partial reverse matching for short names (e.g., "笔").
    let score = 0;
    let matchedField = null;
    if (name && query === name) {
      score = 100;
      matchedField = 'name';
    } else if (name && (query.includes(name) || (query.length >= 2 && name.includes(query)))) {
      score = 80;
      matchedField = 'name';
    } else if (category && (query === category || (category.length >= 2 && query.includes(category)))) {
      score = 40;
      matchedField = 'category';
    } else if (spot && (query === spot || (spot.length >= 2 && query.includes(spot)))) {
      score = 30;
      matchedField = 'location';
    } else if (space && (query === space || (space.length >= 2 && query.includes(space)))) {
      score = 20;
      matchedField = 'space';
    } else if (query.length >= 2 && [note, precise].some(v => v.includes(query))) {
      score = 10;
      matchedField = 'description';
    }
    if (!score) return [];
    return [{ item, location, score, matchedField }];
  });

  results.sort((a, b) =>
    b.score - a.score ||
    (b.item.recordedAt ?? 0) - (a.item.recordedAt ?? 0) ||
    a.item.id.localeCompare(b.item.id)
  );

  return {
    query: rawQuery.trim(),
    matchType: 'lexical',
    count: results.length,
    truncated: results.length > limit,
    results: results.slice(0, limit)
  };
}
