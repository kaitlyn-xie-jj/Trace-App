/**
 * Rename a storage space, or merge it into an already-existing space.
 * Preserves all Scene rows (photos + item JSON) and the target's display order.
 * Uses one SQLite transaction so an unsuccessful update cannot strand scenes.
 */
export class CategoryChangeError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'CategoryChangeError';
    this.statusCode = statusCode;
  }
}

export async function renameOrMergeCategory(db, oldName, newName) {
  if (typeof oldName !== 'string' || !oldName.trim() ||
      typeof newName !== 'string' || !newName.trim() || newName.trim().length > 100) {
    throw new CategoryChangeError('Valid category names are required (1–100 characters)', 400);
  }

  const targetName = newName.trim();
  await db.exec('BEGIN IMMEDIATE');
  try {
    const source = await db.get('SELECT name FROM categories WHERE name = ?', [oldName]);
    if (!source) throw new CategoryChangeError('Source category not found', 404);

    if (oldName === targetName) {
      await db.exec('COMMIT');
      return { action: 'unchanged' };
    }

    const target = await db.get('SELECT name FROM categories WHERE name = ?', [targetName]);

    if (target) {
      // The destination already exists. Re-home scenes before dropping the
      // source category. Do not insert a duplicate category primary key.
      await db.run('UPDATE scenes SET superCategory = ? WHERE superCategory = ?', [targetName, oldName]);
      await db.run('DELETE FROM categories WHERE name = ?', [oldName]);
    } else {
      // A rename should keep the existing category ordering.
      await db.run('UPDATE categories SET name = ? WHERE name = ?', [targetName, oldName]);
      await db.run('UPDATE scenes SET superCategory = ? WHERE superCategory = ?', [targetName, oldName]);
    }

    await db.exec('COMMIT');
    return { action: target ? 'merged' : 'renamed' };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
