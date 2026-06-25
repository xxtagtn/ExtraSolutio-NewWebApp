import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAssignment, normalizeClient, normalizeEvent } from './crud.js';

test('normalizes event billing payment date when provided', () => {
  const payload = normalizeEvent({ billingPaymentDate: '2026-06-05' });

  assert.equal(payload.billingPaymentDate instanceof Date, true);
  assert.equal(payload.billingPaymentDate.toISOString().slice(0, 10), '2026-06-05');
});

test('normalizes empty event billing payment date to null', () => {
  const payload = normalizeEvent({ billingPaymentDate: '' });

  assert.equal(payload.billingPaymentDate, null);
});

test('normalizes event financial totals from budget conversion values', () => {
  const payload = normalizeEvent({
    totalRevenue: '284,50 EUR',
    totalCost: '120,25 EUR',
    realHours: '12,50',
    billableHours: '15,00',
    minimumHoursSnapshot: '5',
  });

  assert.equal(payload.totalRevenue, 284.5);
  assert.equal(payload.totalCost, 120.25);
  assert.equal(payload.realHours, 12.5);
  assert.equal(payload.billableHours, 15);
  assert.equal(payload.minimumHoursSnapshot, 5);
});

test('normalizes the manual staff travel hourly rate', () => {
  const payload = normalizeEvent({
    travelStaffHourlyRate: '7,50€',
  });

  assert.equal(payload.travelStaffHourlyRate, 7.5);
});

test('normalizes client minimum hours as an optional decimal', () => {
  assert.equal(normalizeClient({ minimumHours: '4,5' }).minimumHours, 4.5);
  assert.equal(normalizeClient({ minimumHours: '' }).minimumHours, 0);
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

test('normalizes assignment client sync flag', () => {
  assert.equal(normalizeAssignment({ clientSynced: true }).clientSynced, true);
  assert.equal(normalizeAssignment({ clientSynced: 'false' }).clientSynced, false);
});

test('normalizes assignment real and billable client hours', () => {
  const payload = normalizeAssignment({
    clientRealHours: '3,5',
    clientBillableHours: '5',
  });

  assert.equal(payload.clientRealHours, 3.5);
  assert.equal(payload.clientBillableHours, 5);
});

test('normalizes assignment advance payments', () => {
  const payload = normalizeAssignment({
    advancePayments: [
      { id: 'a1', date: '2026-06-10', amount: '12,50€', note: 'Deslocação', car: true },
      { id: 'a2', date: '2026-06-11', amount: '', note: 'Sem valor' },
    ],
  });

  assert.equal(payload.advancePayments, JSON.stringify([
    { id: 'a1', date: '2026-06-10', amount: 12.5, note: 'Deslocação', car: true },
  ]));
});

test('normalizes assignment deferred payment month', () => {
  assert.equal(normalizeAssignment({ paymentDeferredMonth: '2026-08' }).paymentDeferredMonth, '2026-08');
  assert.equal(normalizeAssignment({ paymentDeferredMonth: '' }).paymentDeferredMonth, null);
});
