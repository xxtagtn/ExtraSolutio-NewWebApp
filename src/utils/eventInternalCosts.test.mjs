import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';
import { eventCostSummary } from './eventCostSummary.js';
import { eventInternalCosts, internalAssignmentCostParts } from './eventInternalCosts.js';
import { buildBalanceOverview } from './balanceMetrics.js';
import { staffAssignmentPaymentTotal, staffPaymentTotal } from './staffPayment.js';
import { calculateTravelAmount, travelSaleBreakdown } from './travelCalculator.js';

function fixture(patch = {}) {
  const event = { id: 85, name: 'Herdade QA', date: '2026-10-16', status: 'finalized',
    split5050: true, travelType: 'kilometers', travelExpenseEnabled: true, vatRateSnapshot: 23,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 4, agreedRate: 10.5 }],
    travelCars: [{ id: 'car-1', km: 180, kmRate: 0.4, durationHours: 2, travelPeople: 4, travelStaffHourlyRate: 10.5 }],
    assignments: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, collaboratorId: i + 1,
      role: 'Emp.Mesa', status: 'confirmed', assignmentDate: '2026-10-16', hourlyRate: 8,
      checkIn: '10:00', checkOut: '00:00', clientCheckIn: '10:00', clientCheckOut: '00:00',
      collaborator: { id: i + 1, includeVat: false },
      advancePayments: i === 0 ? [{ amount: 65, car: true }] : [],
    })), ...patch };
  event.travelExpenseAmount = calculateTravelAmount(event);
  return { ...event, ...calculateEventTotals(event) };
}

test('mandatory regression: reclassifies 545 into 448 work and 97 travel, sale remains 702', () => {
  const event = fixture(), before = structuredClone(event), summary = eventCostSummary(event);
  assert.equal(summary.staffCost, 448);
  assert.equal(summary.travelCarCost, 65);
  assert.equal(summary.travelTimeCost, 32);
  assert.equal(summary.travelCost, 97);
  assert.equal(summary.expenses, 545);
  assert.equal(summary.staffSale, 588);
  assert.equal(summary.travelSale, 114);
  assert.deepEqual(summary.travelSaleBreakdown, { kilometers: 72, time: 42, other: 0 });
  assert.equal(summary.netSale, 702);
  assert.equal(summary.travelMargin, 17);
  assert.equal(summary.tax, event.taxAmount);
  assert.equal(summary.revenue, event.totalRevenue);
  assert.equal(summary.margin, 157);
  assert.equal(summary.margin, summary.netSale - summary.expenses);
  assert.equal(event.realHours, 56);
  assert.equal(event.billableHours, 56);
  assert.deepEqual(event, before);
  const overview = buildBalanceOverview({ services: [event], period: { year: 2026 } });
  assert.equal(overview.eventRows[0].staff - overview.eventRows[0].travel, 448);
  assert.equal(overview.eventRows[0].travel, 97);
  assert.equal(overview.clientRows[0].travel, 97);
  assert.equal(overview.kpis.staffToPay, 545);
  assert.equal(overview.kpis.realMargin, summary.margin);
  assert.deepEqual(event.assignments.map((a) => staffAssignmentPaymentTotal(a, event)), [120, 120, 120, 120]);
});

test('no travel, internal-only travel, car-only and full journey retain existing totals', () => {
  for (const patch of [
    { travelCars: [], travelExpenseEnabled: false },
    { travelExpenseEnabled: false },
    { travelCars: [{ id: 'car-1', km: 180, kmRate: 0.4, durationHours: 0 }] },
    { split5050: false },
  ]) {
    const event = fixture(patch), parts = eventInternalCosts(event);
    assert.equal(parts.costBreakdownComplete, true);
    assert.equal(Number((parts.staffCost + parts.travelCost).toFixed(2)), event.totalCost);
    assert.equal(parts.staffCost, 448);
  }
  assert.equal(eventInternalCosts(fixture({ split5050: false })).travelTimeCost, 64);
  const internalOnly = eventCostSummary(fixture({ travelExpenseEnabled: false }));
  assert.equal(internalOnly.travelCost, 97);
  assert.equal(internalOnly.travelSale, 0);
});

test('VAT, adjustments and rounding reconcile exactly with the existing payment engine', () => {
  for (const vat of [false, true]) for (const work of [0, 0.01, 19.99, 112]) {
    for (const travel of [0, 0.01, 8, 8.97]) for (const adjustment of [-200, -20, -0.03, 0, 2.5]) {
      const parts = internalAssignmentCostParts(work, travel, vat, adjustment, [{ amount: 65, car: true }, { amount: 20 }]);
      assert.equal(Number((parts.staffCost + parts.travelCost).toFixed(2)), Number((staffPaymentTotal(work + travel, vat, adjustment) + 65).toFixed(2)));
      assert.equal(parts.travelCarCost, 65);
      assert.ok(parts.staffCost >= 0 && parts.travelCost >= 0);
    }
  }
});

test('multi-day, split shifts, cancellations and paid travel snapshots reuse eligibility rules', () => {
  const source = fixture();
  const first = source.assignments[0];
  const event = fixture({ isContinuous: true, endDate: '2026-10-17', assignments: [first,
    { ...first, id: 10, plannedCheckIn: '18:00', checkIn: '18:00', checkOut: '20:00', clientCheckIn: '18:00', clientCheckOut: '20:00', advancePayments: [] },
    { ...first, id: 11, assignmentDate: '2026-10-17', advancePayments: [] }],
    cancelledDays: ['2026-10-17'] });
  assert.equal(eventInternalCosts(event).travelTimeCost, 8);
  const paid = fixture({ assignments: [{ ...first, paymentStatus: 'paid' }],
    travelCars: [...source.travelCars, { kind: 'staff_compensation', assignmentId: 1, collaboratorId: 1, carId: '', durationHours: 3 }] });
  assert.equal(eventInternalCosts(paid).travelTimeCost, 12);
});

test('partner costs and taxes are not counted as staff or travel', () => {
  const event = fixture({ externalCosts: [{ supplier: 'Parceiro', type: 'Catering', costAmount: 500, marginPercent: 20, vatType: 'catering' }] });
  const summary = eventCostSummary(event);
  assert.equal(summary.staffCost, 448);
  assert.equal(summary.travelCost, 97);
  assert.equal(summary.partnerCost, 500);
  assert.equal(summary.expenses, 1045);
  assert.equal(summary.netSale, 1302);
  assert.equal(summary.tax, event.taxAmount);
});

test('historical or partial snapshots do not get an invented breakdown or rewritten total', () => {
  const event = { ...fixture(), totalCost: 900 };
  assert.equal(eventInternalCosts(event).costBreakdownComplete, false);
  assert.equal(eventInternalCosts(event).staffInclusiveCost, 900);
  assert.equal(eventCostSummary(event).expenses, 900);
  assert.equal(eventCostSummary(event).travelMargin, null);
  assert.equal(eventInternalCosts({ ...event, totalCost: 545.01 }).costBreakdownComplete, false);
  assert.deepEqual(travelSaleBreakdown(event, 114.01), { kilometers: 0, time: 0, other: 114.01 });
  assert.deepEqual(travelSaleBreakdown({ ...event, travelExpenseAmount: 150 }, 150), { kilometers: 0, time: 0, other: 150 });
  assert.deepEqual(travelSaleBreakdown({ travelType: 'manual', travelExpenseEnabled: true }, 100), { kilometers: 0, time: 0, other: 100 });
});
