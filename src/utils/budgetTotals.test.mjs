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

test('rounds budget role schedules before calculating their amount', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Emp.Mesa', qty: 2, rate: 10, start: '17:43', end: '23:16' },
    ],
    eventDays: [],
    vatMode: 'exempt',
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.baseAmount, 120);
  assert.equal(totals.totalAmount, 120);
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

test('applies discount before VAT in the commercial summary', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Emp.Mesa', qty: 2, rate: 10, start: '10:00', end: '15:00' },
    ],
    eventDays: [],
    vatMode: 'normal_23',
    vatRate: 23,
    travelType: 'manual',
    travelManualAmount: 50,
    discountRate: 10,
  });

  assert.equal(totals.baseAmount, 100);
  assert.equal(totals.travelAmount, 50);
  assert.equal(totals.discountAmount, 15);
  assert.equal(totals.subtotalAmount, 135);
  assert.equal(totals.taxAmount, 31.05);
  assert.equal(totals.totalAmount, 166.05);
});

test('adds external partner costs with margin to the budget total', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Emp.Mesa', qty: 1, rate: 10, start: '10:00', end: '15:00' },
    ],
    externalCosts: [
      {
        type: 'Catering',
        supplier: 'Parceiro A',
        costAmount: '100,00',
        marginPercent: '20',
      },
      {
        type: 'Material',
        supplier: 'Parceiro B',
        costAmount: 50,
        marginPercent: 10,
      },
    ],
    eventDays: [],
    vatMode: 'exempt',
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.baseAmount, 50);
  assert.equal(totals.externalCostsAmount, 175);
  assert.equal(totals.externalCostsBaseAmount, 150);
  assert.equal(totals.externalCostsMarginAmount, 25);
  assert.equal(totals.subtotalAmount, 225);
  assert.equal(totals.taxAmount, 40.25);
  assert.equal(totals.vatBreakdown[23].tax, 40.25);
  assert.equal(totals.totalAmount, 265.25);
});

test('groups own services and external VAT by rate, including catering split', () => {
  const totals = calculateBudgetTotals({
    categories: [
      { role: 'Emp.Mesa', qty: 1, rate: 10, start: '10:00', end: '20:00' },
    ],
    externalCosts: [
      { type: 'Catering', costAmount: 100, marginPercent: 20, vatType: 'catering' },
      { type: 'Bebidas', costAmount: 100, marginPercent: 0, vatType: 'standard_23' },
      { type: 'Material', costAmount: 50, marginPercent: 0, vatType: 'exempt' },
    ],
    vatMode: 'normal_23',
    vatRate: 23,
    travelType: 'none',
    discountRate: 0,
  });

  assert.equal(totals.subtotalAmount, 370);
  assert.equal(totals.vatBreakdown.exempt.base, 50);
  assert.equal(totals.vatBreakdown[13].tax, 13.26);
  assert.equal(totals.vatBreakdown[23].tax, 50.14);
  assert.equal(totals.taxAmount, 63.4);
  assert.equal(totals.totalAmount, 433.4);
});
