import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staffPaymentBreakdown, staffPaymentTotal, staffAssignmentPaymentBalance, staffAssignmentCostTotal } from './staffPayment.js';
import { summarizeStaffPaymentAmounts } from './staffPaymentGroups.js';
import { buildStaffBalance } from './balanceStaff.js';
import { buildBalanceOverview } from './balanceMetrics.js';
import { calculateEventTotals, withCurrentStaffVatCost } from '../../server/utils/eventTotals.js';

const period = { year: '2026', month: '9', clientId: 'all', status: 'all' };
function fixture() {
  const assignments = [[5, 8.5, -2.5], [12, 8, -12], [10, 8, 0], [11.5, 8, 0]].map(([hours, rate, adjustment], index) => ({
    id: index + 1, collaboratorId: 1, collaborator: { id: 1, name: 'Ana Carolina Rodrigues', includeVat: true },
    status: 'confirmed', paymentStatus: 'unpaid', assignmentDate: '2026-09-01', role: 'Emp.Mesa',
    hoursWorked: hours, staffPayableHours: hours, clientRealHours: hours, hourlyRate: rate, paymentAdjustment: adjustment,
  }));
  return { id: 1, name: 'Regressao IVA', status: 'finalized', date: '2026-09-01', clientId: 1,
    totalCost: 367.41, totalRevenue: 1000, taxAmount: 0, assignments };
}
const entries = (event) => event.assignments.map((assignment) => ({ ...assignment, event }));

for (const [label, base, vat, adjustment, expectedBase, expectedVat, expectedTotal] of [
  ['A: no VAT or adjustment', 42.5, false, 0, 42.5, 0, 42.5],
  ['B: no VAT with negative adjustment', 42.5, false, -2.5, 40, 0, 40],
  ['C: VAT without adjustment', 100, true, 0, 100, 23, 123],
  ['D: VAT with negative adjustment', 42.5, true, -2.5, 40, 9.2, 49.2],
  ['E: VAT with positive adjustment', 100, true, 10, 110, 25.3, 135.3],
  ['negative base is capped before VAT', 10, true, -20, 0, 0, 0],
]) {
  test(label, () => {
    assert.deepEqual(staffPaymentBreakdown(base, vat, adjustment), { base: expectedBase, vat: expectedVat, vatRate: vat ? 0.23 : 0, total: expectedTotal });
    assert.equal(staffPaymentTotal(base, vat, adjustment), expectedTotal);
  });
}

test('real 38h30 regression yields base 296, IVA 68.08 and total 364.08, not 367.41', () => {
  const event = fixture();
  const oldCents = event.assignments.reduce((sum, assignment) => sum + Math.round(Number((assignment.hoursWorked * assignment.hourlyRate * 1.23 + assignment.paymentAdjustment).toFixed(2)) * 100), 0);
  assert.equal(oldCents / 100, 367.41);
  const amounts = summarizeStaffPaymentAmounts(entries(event));
  assert.equal(amounts.total.base, 296);
  assert.equal(amounts.total.vat, 68.08);
  assert.equal(amounts.total.total, 364.08);
  assert.equal(buildStaffBalance({ services: [event], period }).totals.hours, 38.5);
  assert.equal(calculateEventTotals(event).totalCost, 364.08);
  assert.equal(buildStaffBalance({ services: [event], period }).totals.cost, 364.08);
});

test('paid/unpaid sums use their actual service rows, updating after individual and bulk status changes', () => {
  const event = fixture();
  event.assignments[0].paymentStatus = 'paid';
  const split = summarizeStaffPaymentAmounts(entries(event));
  assert.equal(split.paid.base, 40);
  assert.equal(split.paid.total, 49.2);
  assert.equal(split.outstanding.base, 256);
  assert.equal(split.outstanding.total, 314.88);
  event.assignments[1].paymentStatus = 'paid';
  const individual = summarizeStaffPaymentAmounts(entries(event));
  assert.equal(individual.paid.base, 124);
  assert.equal(individual.paid.total, 152.52);
  for (const assignment of event.assignments) assignment.paymentStatus = 'paid';
  const bulk = summarizeStaffPaymentAmounts(entries(event));
  assert.equal(bulk.paid.base, 296);
  assert.equal(bulk.paid.total, 364.08);
  assert.equal(bulk.outstanding.base, 0);
  assert.equal(bulk.outstanding.total, 0);
});

test('row rounding remains coherent across gross, base, VAT, all states and group sums', () => {
  const event = fixture();
  event.assignments = Array.from({ length: 51 }, (_, index) => ({ ...event.assignments[0], id: index + 1,
    hoursWorked: 1, clientRealHours: 1, hourlyRate: 8.5, paymentAdjustment: index % 2 ? -0.01 : 0.02,
    paymentStatus: index % 3 ? 'paid' : 'ganho' }));
  const rows = entries(event);
  const amounts = summarizeStaffPaymentAmounts(rows);
  assert.equal(Math.round(amounts.total.base * 100) + Math.round(amounts.total.vat * 100), Math.round(amounts.total.total * 100));
  assert.equal(Math.round(amounts.paid.total * 100) + Math.round(amounts.outstanding.total * 100), Math.round(amounts.total.total * 100));
  assert.equal(rows.reduce((sum, row) => sum + Math.round(staffAssignmentCostTotal(row) * 100), 0), Math.round(amounts.total.total * 100));
});

test('advances stay cash deductions, car stays untaxed and receipt base remains explicit', () => {
  const event = fixture();
  const assignment = { ...entries(event)[0], advancePayments: [{ amount: 10 }, { amount: 40, car: true }] };
  const balance = staffAssignmentPaymentBalance(assignment);
  assert.equal(balance.receiptBase, 40);
  assert.equal(balance.receiptTotal, 49.2);
  assert.equal(balance.total, 79.2);
  assert.equal(balance.car, 40);
  assert.equal(staffAssignmentCostTotal(assignment), 89.2);
  assert.equal(Math.round(balance.base * 100) + Math.round(balance.vat * 100), Math.round(balance.total * 100));
  assert.equal(staffAssignmentPaymentBalance({ ...assignment, advancePayments: [{ amount: 1000 }, { amount: 40, car: true }] }).total, 40);
});

test('read-time historical cost correction reaches event margins and Balancete without changing client totals or data', () => {
  const event = fixture();
  const before = structuredClone(event);
  const corrected = withCurrentStaffVatCost(event);
  assert.equal(corrected.totalCost, 364.08);
  assert.equal(corrected.totalRevenue, 1000);
  assert.equal(corrected.taxAmount, 0);
  const overview = buildBalanceOverview({ services: [corrected], period });
  assert.equal(overview.kpis.staffToPay, 364.08);
  assert.equal(overview.kpis.realMargin, 635.92);
  assert.deepEqual(event, before);
  assert.equal(withCurrentStaffVatCost(corrected), corrected);
});

test('unaffected cost snapshots and non-billable records are not rewritten', () => {
  const event = fixture();
  for (const assignment of event.assignments) assignment.collaborator.includeVat = false;
  assert.equal(withCurrentStaffVatCost(event), event);
  for (const assignment of event.assignments) { assignment.collaborator.includeVat = true; assignment.paymentAdjustment = 0; }
  assert.equal(withCurrentStaffVatCost(event), event);
  event.assignments[0].paymentAdjustment = -2.5;
  event.assignments[0].status = 'cancelled';
  assert.equal(withCurrentStaffVatCost(event), event);
});
