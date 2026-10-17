import test from 'node:test';
import assert from 'node:assert/strict';
import { clientFinancialState } from './clientFinancialState.js';
import { clientPaymentSummary, clientReceiptInvoiceBlocker, clientReceiptRegistrationBlocker } from './clientPayment.js';
import { clientPaymentRecordPatch } from '../../server/services/clientPaymentRecord.js';
import { splitClientBillingRows, expandClientBillingRows } from './clientBilling.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';
import { eventRevenueIsLocked } from '../../server/utils/eventInvoiceProtection.js';

const receiptEvent = (received, signal = 0, extra = {}) => ({ id: 1, clientId: 1, date: '2026-10-10', status: 'finalized',
  totalRevenue: 1763.82, paidAmount: received, signaledAmount: signal, billingStatus: 'paid',
  clientPaymentRecord: { version: 1, entries: [], ...extra } });
const row = (event) => ({ billingGroups: [{ events: [event] }], nonInvoicedServices: [event] });

test('validated-hours adjustment keeps 18.45 due despite the previous paid status', () => {
  const event = receiptEvent(1745.37, 200);
  const state = clientFinancialState(event);
  assert.equal(state.received, 1745.37); assert.equal(state.outstanding, 18.45);
  assert.equal(state.label, 'Parcialmente Pago'); assert.equal(state.missingPayment, true);
  assert.equal(splitClientBillingRows([row(event)]).archivedRows.length, 0);
});

test('signal alone differs from later partial receipts, and full cash wins over a manual invoice flag', () => {
  assert.equal(clientFinancialState(receiptEvent(200, 200)).label, 'Sinalizado');
  assert.equal(clientFinancialState(receiptEvent(500, 200)).label, 'Parcialmente Pago');
  assert.equal(clientFinancialState(receiptEvent(500, 200, { commercialStatus: 'invoiced' })).label, 'Faturado');
  assert.equal(clientFinancialState(receiptEvent(1763.82, 200, { commercialStatus: 'invoiced' })).label, 'Totalmente Pago');
  assert.equal(clientFinancialState(receiptEvent(0)).label, 'Pendente');
});

test('a fully paid Staff service archives only when operationally ready and returns active after a correction', () => {
  const event = receiptEvent(1763.82);
  assert.equal(splitClientBillingRows([row(event)]).archivedRows.length, 1);
  assert.equal(splitClientBillingRows([row({ ...event, status: 'in_progress' })]).archivedRows.length, 0);
  assert.equal(splitClientBillingRows([row({ ...event, status: 'in_progress', financial: { hasInvoice: true }, invoices: [{ status: 'paid' }] })]).archivedRows.length, 0);
  assert.equal(splitClientBillingRows([row({ ...event, paidAmount: 100 })]).activeRows.length, 1);
});

test('existing client grouping and commercial periods remain authoritative', () => {
  for (const billingMethod of ['per_event', 'monthly', 'biweekly', 'prepaid', 'custom']) {
    const events = [receiptEvent(1763.82), { ...receiptEvent(100), id: 2 }];
    const rows = expandClientBillingRows({ id: 1, name: 'Cliente', billingMethod,
      nonInvoicedServices: events, billingGroups: [], invoices: [] });
    assert.equal(rows.flatMap((item) => item.nonInvoicedServices).length, 2);
    assert.equal(splitClientBillingRows(rows).archivedRows.flatMap((item) => item.nonInvoicedServices).some((event) => event.id === 2), false);
  }
});

test('received totals include real event payments without duplicating the period total or paid grouped invoice', () => {
  const events = [{ ...receiptEvent(200, 200), client: { id: 1, name: 'Cliente' } },
    { ...receiptEvent(100), id: 2, totalRevenue: 300, client: { id: 1, name: 'Cliente' } }];
  const noInvoice = buildClientFinancialSummary({ events, period: '2026-10' })[0];
  assert.equal(noInvoice.received, 300); assert.equal(noInvoice.total, 2063.82);
  const paid = buildClientFinancialSummary({ events, period: '2026-10', invoices: [{ id: 1, clientId: 1,
    eventIds: '[1,2]', status: 'paid', issueDate: '2026-10-10', total: 2063.82 }] })[0];
  assert.equal(paid.received, 2063.82); assert.equal(paid.total, 2063.82);
});

test('billing adjustment uses the existing pre-invoice total rule without changing VAT or stored receipts', () => {
  const event = { ...receiptEvent(100), totalRevenue: 100, billingAdjustment: 15, taxAmount: 23 };
  assert.equal(clientPaymentSummary(event).outstanding, 15);
  assert.equal(clientPaymentSummary({ ...event, invoices: [{ status: 'issued' }] }).outstanding, 0);
  assert.equal(clientPaymentSummary({ ...event, billingAdjustment: -10 }).outstanding, 0);
  assert.equal(event.taxAmount, 23); assert.equal(event.paidAmount, 100);
});

test('two paid invoices never discount the same previously counted event cash twice', () => {
  const event = { ...receiptEvent(100), totalRevenue: 200, client: { id: 1, name: 'Cliente' } };
  const invoices = [1, 2].map((id) => ({ id, clientId: 1, eventId: 1, total: 100, status: 'paid', issueDate: '2026-10-10' }));
  const summary = buildClientFinancialSummary({ events: [event], invoices, period: '2026-10' })[0];
  assert.equal(summary.received, 200); assert.equal(summary.total, 200);
});

test('the manual commercial flag survives ordinary event receipt writes', () => {
  const event = { ...receiptEvent(0), billingStatus: 'pending', clientPaymentRecord: JSON.stringify({ version: 1, entries: [], commercialStatus: 'invoiced' }) };
  const patch = { billingStatus: 'partial70', paidAmount: 200, signaledAmount: 200, signaledAt: '2026-10-16' };
  const saved = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch) };
  assert.equal(clientFinancialState(saved).label, 'Faturado');
  assert.equal(clientFinancialState(saved).outstanding, 1563.82);
  assert.equal(eventRevenueIsLocked(saved), false, 'A commercial label is not an issued invoice and must not lock hours or pricing');
});

test('legacy invoiced evidence remains Faturado after a partial receipt and fully paid after actual settlement', () => {
  assert.equal(clientFinancialState(receiptEvent(100, 0, { legacyInvoiced: true })).label, 'Faturado');
  assert.equal(clientFinancialState(receiptEvent(1763.82, 0, { legacyInvoiced: true })).label, 'Totalmente Pago');
});

test('legacy invoiced events accept new receipts without unlocking corrections or issued invoices', () => {
  const event = receiptEvent(100, 0, { legacyInvoiced: true });
  assert.equal(clientReceiptRegistrationBlocker(event), '');
  assert.notEqual(clientReceiptInvoiceBlocker(event), '');
  assert.equal(eventRevenueIsLocked(event), true);
  assert.notEqual(clientReceiptRegistrationBlocker({ ...event, invoices: [{ status: 'issued', issueDate: '2026-10-15' }] }), '');
});
