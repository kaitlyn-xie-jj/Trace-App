import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInventory } from '../server/inventoryProjection.js';
import { searchInventory } from '../server/inventorySearch.js';

const inventory = projectInventory([
  { id: 's1', superCategory: '家庭', locationCategory: '卧室抽屉', timestamp: 2,
    items: [{ itemName: '护照', category: '证件', remarks: '蓝色封皮' },
      { itemName: '耳机', category: '电子产品' }] },
  { id: 's2', superCategory: '工程实验室', locationCategory: '零件柜 A', timestamp: 3,
    items: [{ itemName: 'Pigeon IMU', category: '传感器', preciseLocation: '第二层' },
      { itemName: '电阻', category: '元器件' }] }
]);

test('exact and question-form item search return source evidence', () => {
  const exact = searchInventory(inventory, '护照');
  assert.equal(exact.results.length, 1);
  assert.equal(exact.results[0].score, 100);
  const question = searchInventory(inventory, '我的护照在哪里？');
  assert.equal(question.results[0].item.sourceSceneId, 's1');
  assert.equal(question.results[0].location.name, '卧室抽屉');
});

test('case-insensitive and NFKC matching support lab inventory', () => {
  const result = searchInventory(inventory, 'pigeon imu 放在哪');
  assert.equal(result.results[0].item.name, 'Pigeon IMU');
  assert.equal(result.results[0].location.spaceName, '工程实验室');
});

test('location/category searches return all matching items', () => {
  const location = searchInventory(inventory, '零件柜 A');
  assert.equal(location.count, 2);
  const category = searchInventory(inventory, '传感器');
  assert.equal(category.results[0].item.name, 'Pigeon IMU');
});

test('unmatched query never fabricates a result', () => {
  assert.equal(searchInventory(inventory, '液压泵').count, 0);
});

test('deterministic result limit and safe input bounds', () => {
  const result = searchInventory(inventory, '零件柜 A', { limit: 1 });
  assert.equal(result.count, 2);
  assert.equal(result.results.length, 1);
  assert.equal(result.truncated, true);
  assert.throws(() => searchInventory(inventory, ''), RangeError);
  assert.throws(() => searchInventory(inventory, 'x'.repeat(201)), RangeError);
  assert.throws(() => searchInventory(inventory, '护照', { limit: 0 }), RangeError);
});

test('search does not mutate projected items or locations', () => {
  const before = JSON.stringify(inventory);
  searchInventory(inventory, '工程实验室');
  assert.equal(JSON.stringify(inventory), before);
});

test('short item names never hijack unrelated questions', () => {
  const special = projectInventory([
    { id: 'tiny', superCategory: '书房', locationCategory: '抽屉',
      timestamp: 1, items: [{ itemName: '笔' }, { itemName: '笔记本' }, { itemName: 'M5 螺丝' }] }
  ]);
  const question = searchInventory(special, '笔记本在哪里');
  const direct = question.results.filter(hit => hit.score >= 80);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].item.name, '笔记本');
  assert.equal(searchInventory(special, '笔').results[0].score, 100);
});

test('partial item labels remain candidates but cannot bypass AI fallback', () => {
  const result = searchInventory(inventory, 'Pigeon');
  assert.equal(result.results[0].score, 60);
  assert.equal(result.results[0].matchedField, 'name');
});
