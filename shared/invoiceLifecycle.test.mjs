import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clientPaymentTermDays,
  dueDateFromInvoiceIssue,
  effectiveInvoiceDueDate,
  invoiceLifecycleState,
} from './invoiceLifecycle.js';

function localDateKey(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

test('a draft invoice has no due date and remains unbilled', () => {
  const invoice = {
    status: 'draft',
    issueDate: '2026-07-10',
    client: { paymentTerm: 'days_30' },
  };

  assert.equal(effectiveInvoiceDueDate(invoice), null);
  assert.equal(invoiceLifecycleState(invoice), 'unbilled');
});

test('an issued invoice uses its actual issue date plus the client payment term', () => {
  const invoice = {
    status: 'issued',
    issueDate: '2026-07-10',
    dueDate: '2026-07-11',
    client: { paymentTerm: 'days_30' },
  };

  assert.equal(localDateKey(effectiveInvoiceDueDate(invoice)), '2026-08-09');
  assert.equal(invoiceLifecycleState(invoice, '2026-08-08'), 'due');
  assert.equal(invoiceLifecycleState(invoice, '2026-08-10'), 'overdue');
});

test('a paid invoice is regularized regardless of its due date', () => {
  const invoice = {
    status: 'paid',
    issueDate: '2026-06-01',
    client: { paymentTerm: 'days_15' },
  };

  assert.equal(invoiceLifecycleState(invoice, '2026-07-30'), 'regularized');
});

test('missing client conditions never create an implicit payment term', () => {
  assert.equal(clientPaymentTermDays({}), null);
  assert.equal(dueDateFromInvoiceIssue('2026-07-10', {}), null);
});

test('custom payment terms are accepted only with valid non-negative days', () => {
  assert.equal(clientPaymentTermDays({ paymentTerm: 'custom', paymentTermDays: 12 }), 12);
  assert.equal(clientPaymentTermDays({ paymentTerm: 'custom', paymentTermDays: -1 }), null);
  assert.equal(clientPaymentTermDays({ paymentTerm: 'custom' }), null);
});
