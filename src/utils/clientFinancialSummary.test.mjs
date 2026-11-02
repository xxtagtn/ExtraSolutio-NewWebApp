import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildClientEventReconciliation,
  buildClientFinancialSummary,
} from './clientFinancialSummary.js';

test('consolidates a client and counts a multi-event invoice only once', () => {
  const rows = buildClientFinancialSummary({
    period: '2026-06',
    clients: [{ id: 1, name: 'SSH', status: 'active' }],
    events: [
      { id: 10, date: '2026-06-03', clientId: 1, client: { id: 1, name: 'SSH' }, totalRevenue: 300, billingStatus: 'pending' },
      { id: 11, date: '2026-06-04', clientId: 1, client: { id: 1, name: 'SSH' }, totalRevenue: 400, billingStatus: 'invoiced', financial: { revenue: 400, receivable: 400 } },
      { id: 12, date: '2026-06-05', clientId: 1, client: { id: 1, name: 'SSH' }, totalRevenue: 500, billingStatus: 'invoiced', financial: { revenue: 500, receivable: 500 } },
    ],
    invoices: [{ id: 90, clientId: 1, eventIds: JSON.stringify([11, 12]), status: 'issued', total: 900, issueDate: '2026-06-30' }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventCount, 3);
  assert.equal(rows[0].pendingBilling, 300);
  assert.equal(rows[0].billedOpen, 900);
  assert.equal(rows[0].received, 0);
  assert.equal(rows[0].total, 1200);
  assert.equal(rows[0].invoices.length, 1);
});

test('keeps received invoices separate from open and pending values', () => {
  const rows = buildClientFinancialSummary({
    period: '2026-06',
    clients: [{ id: 1, name: 'BLACK', status: 'active' }],
    events: [
      { id: 20, date: '2026-06-10', clientId: 1, client: { id: 1, name: 'BLACK' }, totalRevenue: 100, billingStatus: 'pending' },
      { id: 21, date: '2026-06-11', clientId: 1, client: { id: 1, name: 'BLACK' }, totalRevenue: 200, billingStatus: 'invoiced', financial: { revenue: 200, receivable: 200 } },
    ],
    invoices: [
      { id: 91, clientId: 1, eventId: 21, status: 'paid', total: 200, issueDate: '2026-06-30' },
    ],
  });

  assert.deepEqual(
    { pending: rows[0].pendingBilling, open: rows[0].billedOpen, received: rows[0].received, total: rows[0].total },
    { pending: 100, open: 0, received: 200, total: 300 },
  );
});

test('applies an event billing adjustment before an invoice is issued', () => {
  const rows = buildClientFinancialSummary({
    period: '2026-06',
    clients: [{ id: 1, name: 'SSH', status: 'active' }],
    events: [
      {
        id: 30,
        date: '2026-06-15',
        clientId: 1,
        client: { id: 1, name: 'SSH' },
        totalRevenue: 100,
        billingAdjustment: 15,
        billingStatus: 'pending',
      },
    ],
  });

  assert.equal(rows[0].adjustments, 15);
  assert.equal(rows[0].pendingBilling, 115);
  assert.equal(rows[0].total, 115);
  assert.equal(rows[0].events[0].displayValue, 115);
});

test('reconciles daily service detail with event travel, extras, tax, and applied adjustment', () => {
  const breakdown = buildClientEventReconciliation({
    totalRevenue: 1000,
    displayValue: 1030,
    billingAdjustment: 30,
    travelExpenseEnabled: true,
    travelExpenseAmount: 100,
    externalCosts: [{ type: 'Material', costAmount: 50, marginPercent: 20, vatType: 'exempt' }],
    taxAmount: 40,
  }, {
    days: [{ billableValue: 700, pricingComplete: true }],
  });

  assert.deepEqual(breakdown, {
    revenue: 1000,
    total: 1030,
    dailyServiceSubtotal: 700,
    travel: 100,
    externalCharge: 60,
    tax: 40,
    adjustment: 30,
    undiscriminated: 100,
    dailyPricingComplete: true,
  });
  assert.equal(
    breakdown.dailyServiceSubtotal + breakdown.travel + breakdown.externalCharge
      + breakdown.tax + breakdown.adjustment + breakdown.undiscriminated,
    breakdown.total,
  );
});

test('does not count disabled travel or an adjustment already excluded from the displayed total', () => {
  const breakdown = buildClientEventReconciliation({
    totalRevenue: 500,
    displayValue: 500,
    billingAdjustment: 25,
    travelExpenseEnabled: false,
    travelExpenseAmount: 90,
  }, {
    days: [{ billableValue: 500, pricingComplete: true }],
  });

  assert.equal(breakdown.travel, 0);
  assert.equal(breakdown.adjustment, 0);
  assert.equal(breakdown.undiscriminated, 0);
});

test('summary bases use recorded period VAT for taxable, exempt and mixed-rate services without changing gross totals', () => {
  const events = [
    { id: 1, totalRevenue: 123, taxAmount: 23 },
    { id: 2, totalRevenue: 80, taxAmount: 0 },
    { id: 3, totalRevenue: 286, taxAmount: 36 },
    { id: 4, totalRevenue: 120, taxAmount: 20, billingStatus: 'invoiced' },
  ].map((event) => ({ date: '2026-10-12', clientId: 1, ...event }));
  const original = JSON.stringify(events);
  const [summary] = buildClientFinancialSummary({ events, period: '2026-10' });
  assert.equal(summary.pendingBilling, 489);
  assert.equal(summary.pendingBillingBase, 430);
  assert.equal(summary.total, 609);
  assert.equal(summary.totalBase, 530);
  assert.equal(summary.billedOpen, 120);
  assert.equal(summary.received, 0);
  assert.equal(JSON.stringify(events), original, 'Presentation must not mutate events');
});

test('summary bases include the existing positive and negative VAT-bearing billing adjustments', () => {
  for (const [adjustment, base, gross] of [[5, 2550, 3136.5], [-5, 2540, 3124.2]]) {
    const [summary] = buildClientFinancialSummary({ events: [{ id: 1, date: '2026-10-12', totalRevenue: 3130.35,
      taxAmount: 585.35, billingAdjustment: adjustment, staffVatRateSnapshot: 23 }] });
    assert.equal(summary.totalBase, base);
    assert.equal(summary.pendingBillingBase, base);
    assert.equal(summary.total, gross);
    assert.equal(summary.pendingBilling, gross);
    assert.equal(summary.adjustments, adjustment);
  }
});

test('linked invoice VAT is not counted again and issued services stay out of pending billing', () => {
  const [summary] = buildClientFinancialSummary({ events: [{ id: 1, clientId: 1, date: '2026-10-10', totalRevenue: 123, taxAmount: 23 }],
    invoices: [{ id: 9, clientId: 1, eventId: 1, issueDate: '2026-10-31', status: 'issued', total: 123, taxAmount: 23 }] });
  assert.equal(summary.total, 123);
  assert.equal(summary.totalBase, 100);
  assert.equal(summary.pendingBillingBase, 0);
  assert.equal(summary.pendingBilling, 0);
  assert.equal(summary.billedOpen, 123);
});

test('standalone issued and paid invoices contribute their actual tax or stored subtotal, never a fixed rate', () => {
  const [summary] = buildClientFinancialSummary({ invoices: [
    { id: 1, clientId: 1, issueDate: '2026-10-31', status: 'issued', total: 106, taxAmount: 6 },
    { id: 2, clientId: 1, issueDate: '2026-10-31', status: 'paid', total: 113, subtotal: 100 },
    { id: 3, clientId: 1, issueDate: '2026-10-31', status: 'cancelled', total: 123, taxAmount: 23 },
  ], period: '2026-10' });
  assert.equal(summary.totalBase, 200);
  assert.equal(summary.total, 219);
  assert.equal(summary.billedOpen, 106);
  assert.equal(summary.received, 113);
  assert.equal(summary.pendingBillingBase, 0);
});

test('period bases follow the exact stored split across months without duplicating event VAT', () => {
  const value = { id: 1, date: '2026-10-31', clientId: 1,
    clientFinance: { allocationRequired: false, billingStatus: 'unbilled', periods: [
      { days: ['2026-10-31'], total: 123, tax: 23, received: 0, outstanding: 123 },
      { days: ['2026-11-01'], total: 113, tax: 13, received: 0, outstanding: 113 },
    ] } };
  for (const [period, gross] of [['2026-10', 123], ['2026-11', 113]]) {
    const [summary] = buildClientFinancialSummary({ events: [value], period });
    assert.equal(summary.totalBase, 100);
    assert.equal(summary.pendingBillingBase, 100);
    assert.equal(summary.total, gross);
  }
  const [year] = buildClientFinancialSummary({ events: [value], period: '2026-00' });
  assert.equal(year.totalBase, 200);
  assert.equal(year.total, 236);
});

test('unknown tax or unallocated periods never produce a guessed tax-exclusive amount', () => {
  const value = { id: 1, date: '2026-10-10', clientId: 1, clientFinance: { billingStatus: 'unbilled', allocationRequired: false,
    periods: [{ days: ['2026-10-10'], total: 123, received: 0, outstanding: 123 }] } };
  const [unknown] = buildClientFinancialSummary({ events: [value] });
  assert.equal(unknown.total, 123);
  assert.equal(unknown.totalBase, null);
  assert.equal(unknown.pendingBillingBase, null);
  const [unallocated] = buildClientFinancialSummary({ events: [{ ...value, clientFinance: { ...value.clientFinance,
    allocationRequired: true, periods: [{ days: ['2026-10-10'], total: null, tax: null, received: null, outstanding: null }] } }] });
  assert.equal(unallocated.allocationRequired, true);
  assert.equal(unallocated.totalBase, null);
  const [invoice] = buildClientFinancialSummary({ invoices: [{ id: 1, issueDate: '2026-10-31', status: 'issued', total: 123 }] });
  assert.equal(invoice.totalBase, null);
});

test('bases and gross totals update immediately from changed source totals and retain cent precision', () => {
  const event = { id: 1, date: '2026-10-10', totalRevenue: 123, taxAmount: 23 };
  assert.equal(buildClientFinancialSummary({ events: [event] })[0].totalBase, 100);
  Object.assign(event, { totalRevenue: 123.01, taxAmount: 23 });
  const [updated] = buildClientFinancialSummary({ events: [event] });
  assert.equal(updated.totalBase, 100.01);
  assert.equal(updated.total, 123.01);
  const [cents] = buildClientFinancialSummary({ events: Array.from({ length: 100 }, (_, i) => ({
    id: i + 1, clientId: 1, date: '2026-10-10', totalRevenue: 0.03, taxAmount: 0.01,
  })) });
  assert.equal(cents.totalBase, 2);
  assert.equal(cents.total, 3);
});
