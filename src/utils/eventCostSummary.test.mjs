import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCostSummary } from './eventCostSummary.js';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';

const assignment = (id, patch = {}) => ({ id, collaboratorId: id, role: 'Emp.Mesa', assignmentDate: '2026-10-16',
  status: 'confirmed', hourlyRate: 8, checkIn: '10:00', checkOut: '00:00', clientCheckIn: '10:00', clientCheckOut: '00:00',
  validationStatus: 'validated', collaborator: { id, name: `Staff ${id}`, includeVat: false }, ...patch });
const fixture = (patch = {}) => ({ id: 42, name: 'FIC Restaurante - FIXOS', date: '2026-10-16', status: 'finalized',
  clientId: 1, client: { id: 1, name: 'FIC Restaurante' }, vatRateSnapshot: 0, billingStatus: 'pending',
  requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 10 }], assignments: [assignment(1), assignment(2)],
  externalCosts: [{ id: 'partner', type: 'Aluguer', supplier: 'alugaqui', costAmount: 430, marginPercent: 0, vatType: 'standard_23' }], ...patch });
function calculated(patch = {}) {
  const event = fixture(patch);
  return { ...event, ...calculateEventTotals(event, event.assignments) };
}

test('FIC regression: existing engine already sells 28h at 10, independently of 224 internal staff cost', () => {
  const event = calculated(), before = structuredClone(event), result = eventCostSummary(event);
  assert.equal(event.realHours, 28); assert.equal(event.billableHours, 28);
  assert.deepEqual(result, { staffCost: 224, staffSale: 280, partnerCost: 430, partnerSale: 430, travelSale: 0,
    staffInclusiveCost: 224, travelCost: 0, travelTimeCost: 0, travelCarCost: 0, costBreakdownComplete: true,
    travelSaleBreakdown: { kilometers: 0, time: 0, other: 0 }, travelMargin: 0,
    netSale: 710, tax: 98.9, taxBreakdown: { staffTax: 0, travelTax: 0, partnerTax: 98.9, taxAmount: 98.9 },
    revenue: 808.9, expenses: 654, undiscriminated: 0, margin: 56, marginPct: 6.9 });
  assert.equal(result.netSale, result.staffSale + result.partnerSale);
  assert.equal(result.revenue, result.netSale + result.tax);
  assert.deepEqual(event, before);
});

test('staff-only event retains separate cost/sale without partner or tax duplication', () => {
  const result = eventCostSummary(calculated({ externalCosts: [] }));
  assert.equal(result.staffCost, 224); assert.equal(result.staffSale, 280); assert.equal(result.expenses, 224);
  assert.equal(result.revenue, 280); assert.equal(result.partnerSale, 0); assert.equal(result.margin, 56);
});

test('external-only event has no staff component and still respects partner tax', () => {
  const result = eventCostSummary(calculated({ requiredRoles: [], assignments: [] }));
  assert.equal(result.staffCost, 0); assert.equal(result.staffSale, 0); assert.equal(result.partnerSale, 430);
  assert.equal(result.expenses, 430); assert.equal(result.revenue, 528.9); assert.equal(result.margin, 0);
});

test('different internal rates cannot change the client hourly price', () => {
  const event = calculated({ assignments: [assignment(1, { hourlyRate: 7 }), assignment(2, { hourlyRate: 9 })] });
  assert.equal(eventCostSummary(event).staffSale, 280); assert.equal(eventCostSummary(event).staffCost, 224);
  const higherSale = calculated({ requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 15 }] });
  assert.equal(eventCostSummary(higherSale).staffCost, 224); assert.equal(eventCostSummary(higherSale).staffSale, 420);
});

test('multiple functions use their existing individual client prices', () => {
  const event = calculated({ requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 10 }, { role: 'Bar', qty: 1, agreedRate: 15 }],
    assignments: [assignment(1), assignment(2, { role: 'Bar', hourlyRate: 12 })] });
  const result = eventCostSummary(event);
  assert.equal(result.staffSale, 350); assert.equal(result.staffCost, 280); assert.equal(result.revenue, 878.9);
});

test('multiple employees in one function count each assignment exactly once', () => {
  const event = calculated({ requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 10 }], assignments: [assignment(1), assignment(2), assignment(3)] });
  assert.equal(eventCostSummary(event).staffSale, 420); assert.equal(eventCostSummary(event).staffCost, 336);
  assert.equal(event.billableHours, 42);
});

test('zero partner markup keeps partner cost and net sale equal without conflating staff values', () => {
  const result = eventCostSummary(calculated());
  assert.equal(result.partnerCost, result.partnerSale); assert.notEqual(result.staffCost, result.staffSale);
});

test('partner markup retains existing cost-based meaning and only taxes the sale once', () => {
  const event = calculated({ externalCosts: [{ type: 'Aluguer', costAmount: 430, marginPercent: 20, vatType: 'standard_23' }] });
  const result = eventCostSummary(event);
  assert.equal(result.partnerCost, 430); assert.equal(result.partnerSale, 516); assert.equal(result.netSale, 796);
  assert.equal(result.tax, 118.68); assert.equal(result.revenue, 914.68); assert.equal(result.margin, 142);
});

test('staff adjustments and cash advances keep their existing cost/payment treatment; client adjustment remains separate', () => {
  const event = calculated({ assignments: [assignment(1, { paymentAdjustment: 5, advancePayments: '[{"amount":10}]' }), assignment(2, { paymentAdjustment: 5 })],
    billingAdjustment: 25 });
  const result = eventCostSummary(event), before = structuredClone(event);
  assert.equal(result.staffCost, 234); assert.equal(result.staffSale, 280); assert.equal(result.margin, 46);
  const clients = buildClientFinancialSummary({ events: [event] });
  assert.equal(clients[0].events[0].displayValue, 833.9);
  assert.equal(result.revenue, 808.9); assert.deepEqual(event, before);
});

test('billable minimum/client hours are reused without changing real or staff hours', () => {
  const event = calculated({ minimumHoursSnapshot: 16, assignments: [assignment(1, { clientCheckIn: '11:00', clientCheckOut: '23:00' }),
    assignment(2, { clientCheckIn: '11:00', clientCheckOut: '23:00' })] });
  const result = eventCostSummary(event);
  assert.equal(event.realHours, 24); assert.equal(event.billableHours, 32);
  assert.equal(result.staffSale, 320); assert.equal(result.staffCost, 192); assert.equal(result.netSale, 750);
  assert.equal(staffAssignmentPaymentTotal(event.assignments[0], event), 96, 'Existing payroll still uses client-real payment hours, not billable minimum');
});

test('event VAT and partner VAT stay independent and margin rules remain unchanged', () => {
  const result = eventCostSummary(calculated({ vatRateSnapshot: 23 }));
  assert.equal(result.netSale, 710); assert.equal(result.tax, 163.3); assert.equal(result.revenue, 873.3);
  assert.equal(result.expenses, 654); assert.equal(result.margin, 56); assert.equal(result.marginPct, 6.4);
});

test('mixed supported partner VAT modes keep their existing precise breakdown', () => {
  const event = calculated({ externalCosts: [{ type: 'Catering', costAmount: 100, marginPercent: 20, vatType: 'catering' },
    { type: 'Outro', costAmount: 50, marginPercent: 0, vatType: 'exempt' }] });
  const result = eventCostSummary(event);
  assert.equal(result.partnerCost, 150); assert.equal(result.partnerSale, 170); assert.equal(result.tax, 17.4);
  assert.equal(result.revenue, 467.4); assert.equal(result.margin, 76);
});

test('Finance Clients uses the existing gross sale, never the internal staff cost', () => {
  const event = calculated();
  const summary = buildClientFinancialSummary({ events: [event], clients: [event.client] });
  assert.equal(summary[0].pendingBilling, 808.9); assert.equal(summary[0].events[0].displayValue, 808.9);
});

test('Finance Staff still pays 8/h and does not adopt the 10/h sale price', () => {
  const event = calculated();
  const payments = event.assignments.map((row) => staffAssignmentPaymentTotal(row, event, event.assignments));
  assert.deepEqual(payments, [112, 112]); assert.equal(payments.reduce((sum, value) => sum + value, 0), 224);
  assert.equal(eventCostSummary(event).staffSale, 280);
});

test('missing client prices and retained historical totals are not silently rebuilt from staff costs', () => {
  const event = calculated({ requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 0 }], totalRevenue: 900, totalCost: 654, taxAmount: 98.9 });
  const before = structuredClone(event), result = eventCostSummary(event);
  assert.equal(result.staffSale, null); assert.equal(result.revenue, 900); assert.equal(result.undiscriminated, 371.1);
  assert.deepEqual(event, before);
  const legacy = { ...calculated(), totalRevenue: 1000 };
  assert.equal(eventCostSummary(legacy).revenue, 1000); assert.equal(eventCostSummary(legacy).undiscriminated, 191.1);
});

test('travel sale and cancelled days follow existing separate financial components', () => {
  const travel = eventCostSummary(calculated({ travelExpenseEnabled: true, travelExpenseAmount: 20 }));
  assert.equal(travel.travelSale, 20); assert.equal(travel.staffSale, 280); assert.equal(travel.netSale, 730);
  const cancelled = eventCostSummary(calculated({ isContinuous: true, endDate: '2026-10-17', cancelledDays: '["2026-10-16"]' }));
  assert.equal(cancelled.staffSale, 0); assert.equal(cancelled.staffCost, 0); assert.equal(cancelled.netSale, 430);
});
