import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';

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
