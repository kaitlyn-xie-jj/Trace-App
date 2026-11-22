import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { projectInventory } from './inventoryProjection.js';
import { searchInventory } from './inventorySearch.js';
import { prepareSceneUpdate } from './sceneUpdates.js';

// Load environment variables
// Try loading .env first, then .env.local (if exists, it won't override set vars by default in older dotenv, 
// but standard practice is usually just .env for prod)
dotenv.config();
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = process.env.DB_FILE || './drawer.db';

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../dist')));

// Database initialization
let db;

async function initDB() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY,
      "order" INTEGER
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      fullImageUrl TEXT,
      timestamp INTEGER,
      locationCategory TEXT,
      superCategory TEXT,
      items TEXT
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    );
  `);

  console.log(`Connected to database at ${DB_FILE}`);
}

// Start listening only after SQLite schema initialization succeeds.

// Routes

// --- Categories ---

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.all('SELECT * FROM categories ORDER BY "order" ASC');
    res.json(categories.map(c => c.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const result = await db.get('SELECT MAX("order") as maxOrder FROM categories');
    const maxOrder = result.maxOrder !== null ? result.maxOrder : -1;

    await db.run('INSERT INTO categories (name, "order") VALUES (?, ?)', [name, maxOrder + 1]);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/order', async (req, res) => {
  const { categories } = req.body;
  if (!Array.isArray(categories)) return res.status(400).json({ error: 'Categories array is required' });

  try {
    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < categories.length; i++) {
      await db.run('UPDATE categories SET "order" = ? WHERE name = ?', [i, categories[i]]);
    }
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await db.run('DELETE FROM categories WHERE name = ?', [name]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:oldName', async (req, res) => {
  const { oldName } = req.params;
  const { newName } = req.body;

  if (!newName) return res.status(400).json({ error: 'New name is required' });

  try {
    await db.run('BEGIN TRANSACTION');

    // Get old order
    const oldCat = await db.get('SELECT "order" FROM categories WHERE name = ?', [oldName]);
    const order = oldCat ? oldCat.order : 0;

    // Insert new, delete old
    await db.run('INSERT INTO categories (name, "order") VALUES (?, ?)', [newName, order]);
    await db.run('DELETE FROM categories WHERE name = ?', [oldName]);

    // Update scenes
    await db.run('UPDATE scenes SET superCategory = ? WHERE superCategory = ?', [newName, oldName]);

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// --- Scenes ---

app.get('/api/scenes', async (req, res) => {
  try {
    const scenes = await db.all('SELECT * FROM scenes ORDER BY timestamp DESC');
    const parsedScenes = scenes.map(scene => ({
      ...scene,
      items: JSON.parse(scene.items || '[]')
    }));
    res.json(parsedScenes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenes', async (req, res) => {
  const scene = req.body;
  if (!scene.id) return res.status(400).json({ error: 'Scene ID is required' });

  try {
    await db.run(
      `INSERT INTO scenes (id, fullImageUrl, timestamp, locationCategory, superCategory, items) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        scene.id,
        scene.fullImageUrl,
        scene.timestamp,
        scene.locationCategory,
        scene.superCategory,
        JSON.stringify(scene.items)
      ]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scenes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM scenes WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/scenes/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const existing = await db.get('SELECT * FROM scenes WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Scene not found' });

    let values;
    try {
      values = prepareSceneUpdate(existing, updates);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    await db.run(
      `UPDATE scenes SET
       fullImageUrl = ?,
       timestamp = ?,
       locationCategory = ?,
       superCategory = ?,
       items = ?
       WHERE id = ?`,
      [...values, id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Trace Core v0: read-only inventory projection ---
// This endpoint is NOT multi-tenant. It retains the same access boundary as
// /api/scenes and must not be exposed publicly without authorization.
app.get('/api/core/inventory', async (req, res) => {
  try {
    const scenes = await db.all(
      'SELECT id, timestamp, locationCategory, superCategory, items FROM scenes ORDER BY timestamp DESC'
    );
    res.json(projectInventory(scenes));
  } catch (err) {
    console.error('Inventory projection failed', err);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

// Lexical retrieval with no model calls, scored against existing scene evidence.
// As with /api/core/inventory, this endpoint is not safe for public multi-tenant use.
app.get('/api/core/search', async (req, res) => {
  const query = req.query.q;
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 200 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'Provide q (1-200 characters) and limit (1-100)' });
  }
  try {
    const scenes = await db.all(
      'SELECT id, timestamp, locationCategory, superCategory, items FROM scenes ORDER BY timestamp DESC'
    );
    const inventory = projectInventory(scenes);
    const results = searchInventory(inventory, query, { limit });
    res.json({ ...results, warnings: inventory.warnings });
  } catch (err) {
    console.error('Inventory search failed', err);
    res.status(500).json({ error: 'Failed to search inventory' });
  }
});

// --- Chats ---

app.get('/api/chats', async (req, res) => {
  try {
    const chats = await db.all('SELECT * FROM chats ORDER BY id ASC');
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', async (req, res) => {
  const { role, content } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO chats (role, content, timestamp) VALUES (?, ?, ?)',
      [role, content, Date.now()]
    );
    res.status(201).json({ id: result.lastID, role, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats', async (req, res) => {
  try {
    await db.run('DELETE FROM chats');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Proxy for Aliyun Dashscope ---
app.post('/dashscope-api/*path', async (req, res) => {
  try {
    // Remove the /dashscope-api prefix to get the real path
    // e.g. /dashscope-api/api/v1/... -> /api/v1/...
    const realPath = req.originalUrl.replace(/^\/dashscope-api/, '');
    const targetUrl = 'https://dashscope.aliyuncs.com' + realPath;

    console.log('[Proxy] Forwarding to:', targetUrl);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': req.headers.authorization,
        'Content-Type': 'application/json',
        // Forward other headers if needed
      },
      body: JSON.stringify(req.body)
    });

    // Forward status and body
    res.status(response.status);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*all', (req, res) => {
  // Don't intercept API requests
  if (req.path.startsWith('/api') || req.path.startsWith('/dashscope-api')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database', err);
    process.exitCode = 1;
  });
