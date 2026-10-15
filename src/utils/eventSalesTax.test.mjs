import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEventSalesTax, eventStaffVatRate, normalizeStaffVatRate } from './eventSalesTax.js';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';
import { eventCostSummary } from './eventCostSummary.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';

const partner = (id, vatType = 'standard_23') => ({ id, type: 'Aluguer', supplier: id, costAmount: 430, marginPercent: 0, vatType });
const row = { id: 1, collaboratorId: 1, status: 'confirmed', role: 'Emp.Mesa', hourlyRate: 8,
  checkIn: '10:00', checkOut: '00:00', clientCheckIn: '10:00', clientCheckOut: '00:00', validationStatus: 'validated' };
function fixture(patch = {}) {
  return { id: 1, date: '2026-10-16', status: 'finalized', requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 10 }],
    vatRateSnapshot: 0, externalCosts: [partner('A')], assignments: [row, { ...row, id: 2, collaboratorId: 2 }], ...patch };
}

for (const [name, patch, expectedTax, revenue] of [
  ['1 Staff only with VAT', { staffVatRateSnapshot: 23, externalCosts: [] }, 64.4, 344.4],
  ['2 Staff only without VAT', { staffVatRateSnapshot: 0, externalCosts: [] }, 0, 280],
  ['3 partner only with VAT', { staffVatRateSnapshot: 23, assignments: [], requiredRoles: [] }, 98.9, 528.9],
  ['4 Staff and partner with VAT', { staffVatRateSnapshot: 23 }, 163.3, 873.3],
  ['5 Staff exempt and partner with VAT', { staffVatRateSnapshot: 0 }, 98.9, 808.9],
  ['6 Staff with VAT and exempt partner', { staffVatRateSnapshot: 23, externalCosts: [partner('A', 'exempt')] }, 64.4, 774.4],
  ['7 partners with multiple VAT configurations', { staffVatRateSnapshot: 23, externalCosts: [partner('A'), partner('B', 'exempt'), partner('C', 'catering')] }, 225.65, 1795.65],
]) test(name, () => {
  const event = fixture(patch), before = structuredClone(event);
  const totals = calculateEventTotals(event);
  assert.equal(totals.taxAmount, expectedTax); assert.equal(totals.totalRevenue, revenue);
  assert.equal(totals.totalCost, (event.assignments.length ? 224 : 0) + event.externalCosts.length * 430);
  assert.deepEqual(event, before);
});

test('legacy rate inheritance, explicit zero, travel independence and current payroll', () => {
  assert.equal(eventStaffVatRate({ vatRateSnapshot: 13 }), 13);
  assert.equal(eventStaffVatRate({ vatRateSnapshot: 23, staffVatRateSnapshot: 0 }), 0);
  const event = fixture({ vatRateSnapshot: 23, staffVatRateSnapshot: 0, travelExpenseEnabled: true, travelExpenseAmount: 100 });
  assert.deepEqual(calculateEventSalesTax(event, { staffSale: 280, travelSale: 100, partnerTax: 98.9 }),
    { staffTax: 0, travelTax: 23, partnerTax: 98.9, taxAmount: 121.9 });
  assert.equal(calculateEventTotals(event).totalRevenue, 931.9);
  assert.equal(staffAssignmentPaymentTotal(row, event), 112);
  const enabled = { ...event, staffVatRateSnapshot: 23 };
  assert.equal(calculateEventTotals(enabled).totalRevenue, 996.3);
  assert.equal(calculateEventTotals(enabled).totalCost, calculateEventTotals(event).totalCost);
  const withTotals = { ...enabled, ...calculateEventTotals(enabled) };
  assert.equal(eventCostSummary(withTotals).taxBreakdown.staffTax, 64.4);
});

test('validates only explicit overrides; null retains old custom rates', () => {
  for (const value of [0, 23, '23', '23,00']) assert.ok([0, 23].includes(normalizeStaffVatRate(value)));
  assert.equal(normalizeStaffVatRate(null), null); assert.equal(normalizeStaffVatRate(undefined), undefined);
  for (const value of ['', 'invalid', -1, 13, 100, false]) assert.throws(() => normalizeStaffVatRate(value), { statusCode: 422 });
});
