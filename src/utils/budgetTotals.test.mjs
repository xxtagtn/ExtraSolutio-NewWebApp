import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBudgetTotals } from './budgetTotals.js';

test('calculates budget total from role quantity, client rate and explicit role hours', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Barman', qty: 2, rate: '10,50€', start: '18:00', end: '23:00' },
    ],
    eventDays: [],
    vatMode: 'exempt',
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.baseAmount, 105);
  assert.equal(totals.totalAmount, 105);
});

test('inherits day hours when a role has no individual schedule', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Emp.Mesa', qty: 4, rate: '12', date: '2026-09-01' },
    ],
    eventDays: [
      { date: '2026-09-01', startTime: '09:00', endTime: '13:30' },
    ],
    vatMode: 'normal_23',
    vatRate: 23,
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.baseAmount, 216);
  assert.equal(totals.taxAmount, 49.68);
  assert.equal(totals.totalAmount, 265.68);
});

test('sums all configured event days for roles applied to every day', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Copa Fina', qty: 1, rate: 11 },
    ],
    eventDays: [
      { date: '2026-09-01', startTime: '09:00', endTime: '13:00' },
      { date: '2026-09-02', startTime: '10:00', endTime: '15:00' },
    ],
    vatMode: 'exempt',
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.baseAmount, 99);
  assert.equal(totals.totalAmount, 99);
});
