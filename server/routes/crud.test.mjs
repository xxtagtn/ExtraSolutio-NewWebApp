import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeClient, normalizeEvent } from './crud.js';

test('normalizes event billing payment date when provided', () => {
  const payload = normalizeEvent({ billingPaymentDate: '2026-06-05' });

  assert.equal(payload.billingPaymentDate instanceof Date, true);
  assert.equal(payload.billingPaymentDate.toISOString().slice(0, 10), '2026-06-05');
});

test('normalizes empty event billing payment date to null', () => {
  const payload = normalizeEvent({ billingPaymentDate: '' });

  assert.equal(payload.billingPaymentDate, null);
});

test('normalizes client role rates and marks the change date when values change', () => {
  const previous = {
    roleRates: JSON.stringify([{ role: 'Barman', rate: 10 }]),
  };
  const payload = normalizeClient({
    name: 'BLACK',
    roleRates: [
      { role: 'Barman', rate: '12,50€' },
      { role: 'Emp.Mesa', rate: '' },
      { role: '', rate: '9' },
    ],
  }, previous);

  assert.deepEqual(JSON.parse(payload.roleRates), [{ role: 'Barman', rate: 12.5 }]);
  assert.equal(payload.roleRatesUpdatedAt instanceof Date, true);
});

test('does not change client role rate date when rates are unchanged', () => {
  const previous = {
    roleRates: JSON.stringify([{ role: 'Barman', rate: 12.5 }]),
    roleRatesUpdatedAt: new Date('2026-06-01T00:00:00.000Z'),
  };
  const payload = normalizeClient({
    roleRates: [{ role: 'Barman', rate: '12,50€' }],
  }, previous);

  assert.equal(payload.roleRates, JSON.stringify([{ role: 'Barman', rate: 12.5 }]));
  assert.equal(payload.roleRatesUpdatedAt, undefined);
});
