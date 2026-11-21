import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInventory } from '../server/inventoryProjection.js';

const scene = (id, space, location, items) => ({
  id, superCategory: space, locationCategory: location,
  timestamp: 1700000000000, items
});

test('projects legacy scenes into shared locations and independently addressable read records', () => {
  const result = projectInventory([
    scene('a', '实验室', '抽屉 1', JSON.stringify([
      { itemName: 'IMU', category: '传感器', preciseLocation: '左侧' },
      { itemName: '电机', category: '执行器' }
    ])),
    scene('b', '实验室', '抽屉 1', [{ itemName: '螺丝' }])
  ]);
  assert.equal(result.items.length, 3);
  assert.equal(result.locations.length, 1);
  assert.equal(result.items[0].locationId, result.items[2].locationId);
  assert.notEqual(result.items[0].id, result.items[2].id);
  assert.equal(result.items[0].identityStatus, 'provisional');
  assert.equal(result.ownershipScope, 'unassigned');
});

test('same drawer name in different spaces remains distinct', () => {
  const result = projectInventory([
    scene('one', '客户家', '抽屉', [{ itemName: '护照' }]),
    scene('two', '实验室', '抽屉', [{ itemName: '电路板' }])
  ]);
  assert.equal(result.locations.length, 2);
  assert.notEqual(result.items[0].locationId, result.items[1].locationId);
});

test('invalid item JSON produces warnings without failing other scenes', () => {
  const result = projectInventory([
    scene('bad', '实验室', '柜子', '{not-json'),
    scene('good', '实验室', '柜子', [{ itemName: '万用表' }])
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.warnings[0].code, 'INVALID_ITEMS_JSON');
});

test('empty and malformed records do not produce phantom items', () => {
  const result = projectInventory([
    scene('a', '', '', [{ itemName: '' }, null, { itemName: '  耳机  ' }]),
    scene('b', '', '', { itemName: 'invalid' }),
    null
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, '耳机');
  assert.equal(result.warnings.length, 4);
});

test('read projection does not mutate the legacy input', () => {
  const scenes = [scene('a', '书房', '抽屉', [{ itemName: '钥匙' }])];
  const before = JSON.stringify(scenes);
  projectInventory(scenes);
  assert.equal(JSON.stringify(scenes), before);
});

test('rejects invalid root payloads', () => {
  assert.throws(() => projectInventory(null), TypeError);
});
