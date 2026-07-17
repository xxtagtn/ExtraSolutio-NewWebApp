import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendEventRateHistory,
  initialEventRateHistory,
  snapshotEventRoleRates,
} from './eventRateSnapshot.js';

test('copies missing client rates into a new event snapshot', () => {
  const roles = snapshotEventRoleRates(
    [{ role: 'Emp.Mesa', qty: 2, agreedRate: null }],
    [{ role: 'Emp.Mesa', rate: 9.5 }],
  );
  assert.deepEqual(roles, [{ role: 'Emp.Mesa', qty: 2, agreedRate: 9.5 }]);
});

test('preserves an old event rate when the client table changes', () => {
  const roles = snapshotEventRoleRates(
    [{ role: 'Emp.Mesa', qty: 2, agreedRate: null }],
    [{ role: 'Emp.Mesa', rate: 10.2 }],
    [{ role: 'Emp.Mesa', qty: 2, agreedRate: 9.5 }],
  );
  assert.equal(roles[0].agreedRate, 9.5);
});

test('keeps an explicit event-specific negotiated rate', () => {
  const roles = snapshotEventRoleRates(
    [{ role: 'Barman', qty: 1, agreedRate: 13.25 }],
    [{ role: 'Barman', rate: 12 }],
    [{ role: 'Barman', qty: 1, agreedRate: 11 }],
  );
  assert.equal(roles[0].agreedRate, 13.25);
});

test('records the initial snapshot and later manual rate changes', () => {
  const at = new Date('2026-07-13T10:00:00.000Z');
  const initial = initialEventRateHistory([{ role: 'Emp.Mesa', agreedRate: 9.5 }], at);
  const updated = appendEventRateHistory(
    initial,
    [{ role: 'Emp.Mesa', agreedRate: 9.5 }],
    [{ role: 'Emp.Mesa', agreedRate: 10 }],
    new Date('2026-07-14T10:00:00.000Z'),
  );
  const rows = JSON.parse(updated);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].changes, [{ role: 'Emp.Mesa', from: 9.5, to: 10 }]);
});
