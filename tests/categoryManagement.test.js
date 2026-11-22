import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { renameOrMergeCategory, CategoryChangeError } from '../server/categoryManagement.js';

async function fixture() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE categories (name TEXT PRIMARY KEY, "order" INTEGER);
    CREATE TABLE scenes (id TEXT PRIMARY KEY, superCategory TEXT, items TEXT, fullImageUrl TEXT);
    INSERT INTO categories VALUES ('书房', 0), ('实验室', 1), ('卧室', 2);
    INSERT INTO scenes VALUES ('s1', '书房', '[{"itemName":"护照"}]', 'photo1');
    INSERT INTO scenes VALUES ('s2', '实验室', '[{"itemName":"IMU"}]', 'photo2');
    INSERT INTO scenes VALUES ('s3', '书房', '[{"itemName":"耳机"}]', 'photo3');
  `);
  return db;
}

test('merge into existing category preserves every scene and target order', async () => {
  const db = await fixture();
  try {
    const before = await db.all('SELECT id, items, fullImageUrl FROM scenes ORDER BY id');
    const result = await renameOrMergeCategory(db, '书房', '实验室');
    assert.equal(result.action, 'merged');
    assert.deepEqual((await db.all('SELECT name, "order" FROM categories ORDER BY "order"')).map(r => r.name),
      ['实验室', '卧室']);
    assert.equal((await db.get('SELECT "order" AS ord FROM categories WHERE name = ?', '实验室')).ord, 1);
    assert.deepEqual((await db.all('SELECT id, items, fullImageUrl FROM scenes ORDER BY id')), before);
    assert.deepEqual((await db.all('SELECT superCategory FROM scenes ORDER BY id')).map(r => r.superCategory),
      ['实验室','实验室','实验室']);
  } finally { await db.close(); }
});

test('rename to a new category preserves sort order and all items', async () => {
  const db = await fixture();
  try {
    assert.equal((await renameOrMergeCategory(db, '书房', '客厅')).action, 'renamed');
    const updated = await db.get('SELECT "order" AS ord FROM categories WHERE name = ?', '客厅');
    assert.equal(updated.ord, 0);
    assert.equal((await db.get('SELECT superCategory FROM scenes WHERE id = ?', 's1')).superCategory, '客厅');
    assert.equal((await db.get('SELECT items FROM scenes WHERE id = ?', 's1')).items, '[{"itemName":"护照"}]');
  } finally { await db.close(); }
});

test('same-name update is no-op, nonexistent category returns 404', async () => {
  const db = await fixture();
  try {
    assert.equal((await renameOrMergeCategory(db, '书房', '书房')).action, 'unchanged');
    await assert.rejects(renameOrMergeCategory(db, '不存在', '新位置'), e =>
      e instanceof CategoryChangeError && e.statusCode === 404);
    assert.equal((await db.get('SELECT count(*) AS n FROM categories')).n, 3);
  } finally { await db.close(); }
});

test('blank category is rejected without modifying database', async () => {
  const db = await fixture();
  try {
    await assert.rejects(renameOrMergeCategory(db, '书房', '  '), e =>
      e instanceof CategoryChangeError && e.statusCode === 400);
    assert.equal((await db.get('SELECT superCategory FROM scenes WHERE id = ?', 's1')).superCategory, '书房');
  } finally { await db.close(); }
});

test('database error rolls back category and scene modifications', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      CREATE TRIGGER reject_reassignment BEFORE UPDATE OF superCategory ON scenes
      WHEN NEW.superCategory = '实验室'
      BEGIN SELECT RAISE(ABORT, 'update denied'); END;
    `);
    await assert.rejects(renameOrMergeCategory(db, '书房', '实验室'), /update denied/);
    assert.equal((await db.get('SELECT count(*) AS n FROM categories')).n, 3);
    assert.equal((await db.get('SELECT superCategory FROM scenes WHERE id = ?', 's1')).superCategory, '书房');
  } finally { await db.close(); }
});
