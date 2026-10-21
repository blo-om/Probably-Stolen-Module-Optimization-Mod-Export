import assert from 'node:assert/strict';
import test from 'node:test';
import { getSaveItemName, readSaveInventory } from '../src/saveImport.ts';

const inventorySave = items => JSON.stringify({ mainInvJSON: JSON.stringify({ saveItems: items }) });

test('reads standard nested inventory JSON without changing names or escapes', () => {
    const items = [{ name: '“泥炭”合成肉', note: 'C:\\games\\“quoted”\n"text"', uniqueId: 42 }];
    assert.deepEqual(readSaveInventory(inventorySave(items), 'mainInvJSON'), items);
});

test('reads the Chinese save escape pattern at the outer JSON layer', () => {
    const items = [{ name: '“泥炭”合成肉', uniqueId: 42 }];
    const text = inventorySave(items).replace(/[“”]/g, quote => '\\' + quote);
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), items);
});

test('reads escaped typographic quotes inside the inventory JSON as well', () => {
    const text = JSON.stringify({ mainInvJSON: '{"saveItems":[{"name":"\\“test\\”"}]}' });
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), [{ name: '“test”' }]);
});

test('preserves valid literal backslashes when a different quote needs repair', () => {
    const items = [{ name: '“test”', literal: '\\“' }];
    const text = inventorySave(items).replace('“test', '\\“test');
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), items);
});

test('does not accept unrelated malformed or truncated JSON', () => {
    assert.throws(() => readSaveInventory('{"mainInvJSON":"\\x"}', 'mainInvJSON'));
    assert.throws(() => readSaveInventory('{"mainInvJSON":"unfinished', 'mainInvJSON'));
    assert.equal(readSaveInventory('{}', 'mainInvJSON'), null);
});

test('identifies localized machines and modules without changing their names', () => {
    const item = { identifier: 'moisture_farm', name: '水分收集器' };
    assert.equal(getSaveItemName(item), 'Moisture Farm');
    assert.equal(item.name, '水分收集器');
    assert.equal(getSaveItemName({ identifier: 'wine_rack', name: '催陈器' }), 'AgeWell');
    assert.equal(getSaveItemName({ identifier: 'system_module_fineness', name: '精炼模组' }), 'Refinement Module');
    assert.equal(getSaveItemName({ identifier: 'system_module_efficiancy', name: '效率模组' }), 'Efficiency Module');
    assert.equal(getSaveItemName({ identifier: 'node_medium', name: '节点（中）' }), 'Node (Medium)');
    assert.equal(getSaveItemName({ identifier: 'alarm_module_transmitter', name: '警报传输模组' }), 'Alarm Transmitter Module');
    assert.equal(getSaveItemName({ name: 'Neural Core Module (Capped)' }), 'Neural Core Module (Capped)');
    assert.equal(getSaveItemName({ identifier: 'unknown', name: 'Unknown item' }), 'Unknown item');
});
