import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertEventRevenueEditable,
  eventRevenueIsLocked,
  hasAssignmentRevenueImpact,
  hasEventFinancialImpact,
  invoiceEventIds,
  invoiceIsIssuedForEvent,
} from './eventInvoiceProtection.js';

test('reads direct and grouped invoice event links without false matches', () => {
  const invoice = {
    eventId: 7,
    eventIds: JSON.stringify([11, 21]),
    status: 'issued',
    issueDate: '2026-09-04',
  };

  assert.deepEqual(invoiceEventIds(invoice), [11, 21, 7]);
  assert.equal(invoiceIsIssuedForEvent(invoice, 21), true);
  assert.equal(invoiceIsIssuedForEvent(invoice, 2), false);
});

test('classifies only revenue-affecting updates as protected', () => {
  assert.equal(hasEventFinancialImpact({ requiredRoles: [] }), true);
  assert.equal(hasEventFinancialImpact({ notes: 'Nota interna' }), false);
  assert.equal(hasAssignmentRevenueImpact({ plannedCheckOut: '18:00' }), true);
  assert.equal(hasAssignmentRevenueImpact({ paymentStatus: 'paid' }), false);
  assert.equal(eventRevenueIsLocked({ billingStatus: 'invoiced' }), true);
  assert.equal(eventRevenueIsLocked({ status: 'finalized', billingStatus: 'pending' }), false);
});

test('rejects financial changes after an invoice is issued', async () => {
  const prisma = {
    event: { findUnique: async () => ({ id: 42, status: 'finalized', billingStatus: 'pending' }) },
    invoice: {
      findMany: async () => [{
        id: 5,
        number: 'FT 2026/5',
        eventId: 42,
        eventIds: null,
        status: 'issued',
        issueDate: '2026-09-04',
      }],
    },
  };

  await assert.rejects(
    () => assertEventRevenueEditable(prisma, 42),
    (error) => error.statusCode === 409 && error.message.includes('FT 2026/5'),
  );
});

test('allows changes while the linked invoice is only a draft', async () => {
  const prisma = {
    event: { findUnique: async () => ({ id: 42, status: 'drafting', billingStatus: 'pending' }) },
    invoice: {
      findMany: async () => [{
        id: 6,
        eventId: 42,
        status: 'draft',
        issueDate: '2026-09-04',
      }],
    },
  };

  await assert.doesNotReject(() => assertEventRevenueEditable(prisma, 42));
});

test('rejects legacy events already marked as invoiced without an invoice row', async () => {
  const prisma = {
    event: { findUnique: async () => ({ id: 42, status: 'finalized', billingStatus: 'invoiced' }) },
    invoice: { findMany: async () => [] },
  };

  await assert.rejects(
    () => assertEventRevenueEditable(prisma, 42),
    (error) => error.statusCode === 409 && error.message.includes('faturação emitida/fechada'),
  );
});
