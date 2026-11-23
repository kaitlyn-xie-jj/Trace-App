import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSceneExport, serializeSceneExport } from '../utils/sceneExport.js';

const input = [
  {
    id: 'scene-1', fullImageUrl: 'data:image/jpeg;base64,ZmFrZQ==',
    timestamp: 1711111111111, locationCategory: '抽屉 A',
    superCategory: '实验室',
    items: [{ itemName: 'M5 螺丝', box_2d: [1, 2, 3, 4], remarks: '蓝色盒子' }],
    customFutureMetadata: { foo: 'bar' }
  }
];

test('export retains full photograph, unknown metadata and exact item coordinates', () => {
  const saved = JSON.parse(serializeSceneExport(input, ['实验室'], '2026-11-23T09:00:00.000Z'));
  assert.equal(saved.format, 'trace-scenes-export');
  assert.equal(saved.formatVersion, 1);
  assert.equal(saved.exportedAt, '2026-11-23T09:00:00.000Z');
  assert.deepEqual(saved.categories, ['实验室']);
  assert.deepEqual(saved.scenes, input);
  assert.match(saved.notice, /one-click import/);
});

test('export never mutates original scene, item or category inputs', () => {
  const categories = ['实验室'];
  const before = JSON.stringify({ input, categories });
  const saved = makeSceneExport(input, categories);
  saved.scenes[0].items[0].itemName = 'modified';
  saved.categories.push('new');
  assert.equal(JSON.stringify({ input, categories }), before);
});

test('empty existing account is exportable', () => {
  const saved = makeSceneExport([], []);
  assert.equal(saved.scenes.length, 0);
  assert.equal(saved.categories.length, 0);
});

test('incomplete or malformed fetches never generate misleading exports', () => {
  assert.throws(() => serializeSceneExport(null, []), TypeError);
  assert.throws(() => serializeSceneExport([], undefined), TypeError);
  assert.throws(() => serializeSceneExport([{ id: 'broken', items: '{}' }], []), TypeError);
  assert.throws(() => serializeSceneExport([{ id: 'a', items: [] }], [42]), TypeError);
  assert.throws(() => serializeSceneExport([], [], 'not-a-date'), TypeError);
});
