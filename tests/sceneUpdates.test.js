import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSceneUpdate } from '../server/sceneUpdates.js';

const oldScene = {
  id: 's-1', fullImageUrl: 'old-photo', timestamp: 1700000000000,
  locationCategory: '抽屉', superCategory: '书房',
  items: '[{"itemName":"护照"}]'
};

test('partial edit retains existing fields and serialized items', () => {
  assert.deepEqual(prepareSceneUpdate(oldScene, { locationCategory: '床头柜' }), [
    'old-photo', 1700000000000, '床头柜', '书房', oldScene.items
  ]);
});

test('moving a scene to Uncategorized clears superCategory', () => {
  const values = prepareSceneUpdate(oldScene, { superCategory: undefined });
  assert.equal(values[3], null);
  assert.equal(oldScene.superCategory, '书房');
});

test('new item list is serialized for existing SQLite schema', () => {
  const values = prepareSceneUpdate(oldScene, { items: [{ itemName: 'IMU' }] });
  assert.deepEqual(JSON.parse(values[4]), [{ itemName: 'IMU' }]);
});

test('empty arrays and explicit photo clearing are honored', () => {
  const values = prepareSceneUpdate(oldScene, { items: [], fullImageUrl: null });
  assert.equal(values[0], null);
  assert.equal(values[4], '[]');
});

test('invalid timestamps, locations, and item payloads are rejected', () => {
  assert.throws(() => prepareSceneUpdate(oldScene, { timestamp: 'yesterday' }), TypeError);
  assert.throws(() => prepareSceneUpdate(oldScene, { locationCategory: '' }), TypeError);
  assert.throws(() => prepareSceneUpdate(oldScene, { items: { itemName: 'bad' } }), TypeError);
  assert.throws(() => prepareSceneUpdate(oldScene, { items: 'not-json' }), TypeError);
});

test('the source scene and update payload are not mutated', () => {
  const updates = { items: [{ itemName: '螺丝' }] };
  const before = JSON.stringify({ oldScene, updates });
  prepareSceneUpdate(oldScene, updates);
  assert.equal(JSON.stringify({ oldScene, updates }), before);
});
