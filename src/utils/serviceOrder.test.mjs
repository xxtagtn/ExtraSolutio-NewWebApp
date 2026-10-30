import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyServiceOrder, moveVisibleService, sortServiceRows, validServiceOrder } from './serviceOrder.js';

test('date ordering is deterministic and does not mutate events', () => {
  const rows = [{ id: 1, date: '2026-10-01' }, { id: 2, date: '2026-11-01' }, { id: 3, date: '2026-11-01' }];
  assert.deepEqual(sortServiceRows(rows).map((row) => row.id), [3, 2, 1]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
});
test('personal ordering survives date mode and places new events first', () => {
  const rows = [1, 2, 3, 4].map((id) => ({ id, date: `2026-10-0${id}` }));
  const preference = { mode: 'manual', ids: [2, 1, 99, 3], version: 1 };
  assert.deepEqual(sortServiceRows(rows, preference).map((row) => row.id), [4, 2, 1, 3]);
  assert.deepEqual(sortServiceRows(rows, { ...preference, mode: 'date' }).map((row) => row.id), [4, 3, 2, 1]);
  assert.deepEqual(preference.ids, [2, 1, 99, 3]);
});
test('filtered reorder replaces visible slots only, preserving hidden and paginated events', () => {
  assert.deepEqual(moveVisibleService([1, 2, 3, 4, 5], [1, 3, 5], 5, 1), [5, 2, 1, 4, 3]);
  assert.deepEqual(moveVisibleService([1, 2, 3, 4, 5], [3, 4], 3, 4), [1, 2, 4, 3, 5]);
  assert.equal(moveVisibleService([1, 2], [1, 2], 1, 1), null);
  assert.equal(moveVisibleService([1, 2], [1, 3], 1, 3), null);
});
test('validates IDs, modes, duplicates and optimistic versions', () => {
  assert.equal(validServiceOrder(emptyServiceOrder()), true);
  for (const patch of [{ ids: [1, 1] }, { ids: [-1] }, { ids: ['1'] }, { ids: [1.1] }, { mode: 'other' }, { version: -1 }, { version: '1' }, { ids: Array(20001).fill(1) }]) {
    assert.equal(Boolean(validServiceOrder({ ...emptyServiceOrder(), ...patch })), false);
  }
});
