import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';
import { normalizeInvoice } from '../../server/routes/crud.js';
import { calculateEventSalesTax } from './eventSalesTax.js';
import { eventCostSummary } from './eventCostSummary.js';
import { externalCostVatBreakdown, externalCostsTotals } from './externalCosts.js';
import { calculateBudgetTotals } from './budgetTotals.js';
import { clientBillingAdjustment } from './clientPaymentTotal.js';
import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';
import { paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { moneyCents, sumMoney } from '../../shared/money.js';

function event() {
  return { id: 1, name: 'Cocktail Saldanha - Blank (rounding fixture)', date: '2026-10-28', endDate: '2026-10-30',
    status: 'finalized', isContinuous: true, staffVatRateSnapshot: 23, vatRateSnapshot: 23,
    clientId: 1, client: { id: 1, name: 'BLANK', billingMethod: 'per_event' }, minimumHoursSnapshot: 10,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 10.5 }], externalCosts: [],
    assignments: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, collaboratorId: i % 3 + 1, assignmentDate: `2026-10-${28 + Math.floor(i / 3)}`,
      role: 'Emp.Mesa', status: 'confirmed', validationStatus: 'validated', hourlyRate: 8,
      checkIn: '08:00', checkOut: '18:00', clientCheckIn: '08:00', clientCheckOut: i < 3 ? '19:00' : '18:00' })),
  };
}

test('Cocktail regression: 93h at 10.50 gives 976.50 base + 224.60 VAT = 1201.10, with no undiscriminated cent', () => {
  const source = event(), before = structuredClone(source), totals = calculateEventTotals(source);
  assert.equal(totals.billableHours, 93);
  assert.equal(totals.taxAmount, 224.6); assert.equal(totals.totalRevenue, 1201.1);
  const saved = { ...source, ...totals }, summary = eventCostSummary(saved);
  assert.equal(summary.staffSale, 976.5); assert.equal(summary.netSale, 976.5);
  assert.equal(summary.undiscriminated, 0); assert.equal(summary.taxBreakdown.staffTax, 224.6);
  assert.equal(summary.margin, sumMoney(976.5, -summary.expenses));
  const fiscal = paymentFinancialSnapshot(saved), finance = buildClientFinanceSnapshot(saved);
  assert.equal(fiscal.base, 976.5); assert.equal(fiscal.tax, 224.6);
  assert.equal(finance.periods[0].tax, 224.6);
  const [client] = buildClientFinancialSummary({ events: [saved], period: '2026-10' });
  assert.equal(client.pendingBillingBase, 976.5); assert.equal(client.pendingBilling, 1201.1);
  assert.deepEqual(source, before);
});

test('same-rate Staff/travel grouping is preserved and its displayed VAT components sum exactly', () => {
  assert.deepEqual(calculateEventSalesTax({ staffVatRateSnapshot: 23, vatRateSnapshot: 23 }, { staffSale: 0.02, travelSale: 0.02 }),
    { staffTax: 0, travelTax: 0.01, partnerTax: 0, taxAmount: 0.01 });
  for (const staffRate of [0, 13, 23]) for (const travelRate of [0, 13, 23]) {
    const result = calculateEventSalesTax({ staffVatRateSnapshot: staffRate, vatRateSnapshot: travelRate },
      { staffSale: 976.5, travelSale: 64.5, partnerTax: 47.52 });
    assert.equal(moneyCents(result.taxAmount), moneyCents(result.staffTax) + moneyCents(result.travelTax) + moneyCents(result.partnerTax));
  }
});

test('partner 23 percent and catering groups reconcile their rounded bases, VAT and gross amounts', () => {
  assert.equal(externalCostVatBreakdown(976.5).taxAmount, 224.6);
  const catering = externalCostVatBreakdown(430, 'catering');
  assert.equal(catering.vat13Amount, 47.52); assert.equal(catering.vat23Amount, 14.84);
  assert.equal(catering.taxAmount, 62.36); assert.equal(catering.grossAmount, 492.36);
  for (const type of ['standard_23', 'catering', 'exempt']) for (let cents = 1; cents < 10000; cents += 13) {
    const result = externalCostVatBreakdown(cents / 100, type);
    assert.equal(moneyCents(result.exemptBase) + moneyCents(result.vat13Base) + moneyCents(result.vat23Base), cents);
    assert.equal(moneyCents(result.taxAmount), moneyCents(result.vat13Amount) + moneyCents(result.vat23Amount));
    assert.equal(moneyCents(result.grossAmount), cents + moneyCents(result.taxAmount));
  }
  const mixed = externalCostsTotals([{ type: 'Material', costAmount: 976.5 }, { type: 'Catering', costAmount: 430, vatType: 'catering' }]);
  assert.equal(moneyCents(mixed.grossAmount), moneyCents(mixed.chargeAmount) + moneyCents(mixed.taxAmount));
});

test('budget and invoice creation use the same half-cent policy as events', () => {
  const budget = calculateBudgetTotals({ categories: [{ role: 'Emp.Mesa', qty: 1, rate: 976.5, start: '10:00', end: '11:00' }], vatRate: 23 });
  assert.equal(budget.subtotalAmount, 976.5); assert.equal(budget.taxAmount, 224.6); assert.equal(budget.totalAmount, 1201.1);
  const invoice = normalizeInvoice({ subtotal: 976.5, taxRate: 23 });
  assert.equal(invoice.subtotal, budget.subtotalAmount); assert.equal(invoice.taxAmount, budget.taxAmount); assert.equal(invoice.total, budget.totalAmount);
  assert.deepEqual(normalizeInvoice({ status: 'paid' }), { status: 'paid' }, 'Status-only changes never recalculate an invoice');
  for (const adjustment of [976.5, -976.5]) assert.equal(clientBillingAdjustment({ billingAdjustment: adjustment, staffVatRateSnapshot: 23 }).tax,
    adjustment > 0 ? 224.6 : -224.6);
});

test('discounted mixed-rate budgets retain exact base/VAT/total and fiscal group sums', () => {
  for (const amount of [0.01, 0.03, 0.1, 0.5, 1.005, 64.5, 430, 976.5]) for (const discountRate of [0, 5, 12.5, 70, 100]) {
    const result = calculateBudgetTotals({ categories: [{ role: 'Staff', qty: 1, rate: amount, start: '10:00', end: '11:00' }],
      vatRate: 23, discountRate, externalCosts: [{ type: 'Catering', costAmount: amount, vatType: 'catering' },
        { type: 'Material', costAmount: amount, vatType: 'exempt' }] });
    assert.equal(moneyCents(result.totalAmount), moneyCents(result.subtotalAmount) + moneyCents(result.taxAmount));
    assert.equal(moneyCents(result.taxAmount), moneyCents(result.vatBreakdown[13].tax) + moneyCents(result.vatBreakdown[23].tax));
    assert.equal(moneyCents(result.subtotalAmount), Object.values(result.vatBreakdown).reduce((sum, part) => sum + moneyCents(part.base), 0));
    assert.equal(moneyCents(result.taxAmount), moneyCents(result.ownServicesTaxAmount) + moneyCents(result.externalCostsTaxAmount));
    assert.ok(result.externalCostsTaxAmount >= 0);
  }
});

test('legacy stored totals, issued snapshots, actual cash and hours are not silently repaired or hidden', () => {
  const source = { ...event(), totalRevenue: 1201.1, taxAmount: 224.59, totalCost: 759.5, paidAmount: 100,
    invoices: [{ id: 1, status: 'issued', total: 1201.1, taxAmount: 224.59 }],
    clientPaymentRecord: { version: 1, entries: [{ id: 'paid', type: 'signal', amount: 100, fiscal: { base: 81.3, tax: 18.7, total: 100 } }] } };
  const before = structuredClone(source), summary = eventCostSummary(source);
  assert.equal(summary.revenue, 1201.1); assert.equal(summary.tax, 224.59); assert.equal(summary.undiscriminated, 0.01);
  assert.equal(summary.taxBreakdown, null, 'A newly calculated VAT breakdown cannot be shown as the old recorded VAT');
  const retained = calculateEventTotals(source, source.assignments, { preserveClientTotals: true });
  assert.equal(retained.totalRevenue, 1201.1); assert.equal(retained.taxAmount, 224.59);
  assert.deepEqual(source, before);
});
