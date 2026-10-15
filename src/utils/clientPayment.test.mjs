import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClientSignalHistoryPreserved, buildClientPaymentPayload, buildClientReceiptReversal, buildClientSignalReversal,
  clientPaymentDraft, clientPaymentFieldsUnchanged, clientPaymentSummary, clientSignalReversalBlocker, validateClientPaymentUpdate } from './clientPayment.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';

const event = { totalRevenue: 252, billingStatus: 'partial70', signaledAmount: 157.5, paidAmount: 157.5,
  signaledAt: '2026-10-09', remainingPaymentDate: '2026-10-14', billingPaymentDate: null };
const paidDraft = { ...clientPaymentDraft(event), billingStatus: 'paid', remainingReceived: '94,50', billingPaymentDate: '2026-10-14' };

test('service edits distinguish payment intent from price, VAT and other financial configuration', () => {
  const existing = { ...event, billingStatus: 'pending', signaledAmount: 816.23, paidAmount: 1166.04,
    signaledAt: null, billingPaymentDate: new Date('2026-07-27') };
  const draft = { ...existing, signaledAmount: '816,23', paidAmount: '1.166,04', signaledAt: '',
    remainingPaymentDate: '2026-10-14', billingPaymentDate: undefined,
    totalRevenue: 2000, requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 20 }], staffVatRateSnapshot: 23 };
  assert.equal(clientPaymentFieldsUnchanged(draft, existing), true);
  for (const patch of [{ billingStatus: 'partial70' }, { signaledAmount: '0' }, { paidAmount: '0' },
    { remainingPaymentDate: '2026-10-20' }, { signaledAt: '2026-10-01' }, { billingPaymentDate: null }]) {
    assert.equal(clientPaymentFieldsUnchanged({ ...draft, ...patch }, existing), false);
  }
  assert.equal(clientPaymentFieldsUnchanged({ totalRevenue: 2000 }, existing), true);
});

test('payment comparisons normalize monetary cents and dates without treating formatting as an edit', () => {
  assert.equal(clientPaymentFieldsUnchanged({ ...event, signaledAmount: '157,50', paidAmount: '157,50',
    signaledAt: '2026-10-09T00:00:00.000Z', billingPaymentDate: '' }, event), true);
  assert.equal(clientPaymentFieldsUnchanged({ paidAmount: '157,51' }, event), false);
  assert.equal(clientPaymentFieldsUnchanged({ paidAmount: 0, signaledAmount: '', signaledAt: '' },
    { paidAmount: null, signaledAmount: null, signaledAt: null }), true);
});

test('planned remaining date never records a receipt, even when overdue', () => {
  for (const remainingPaymentDate of ['2026-10-14', '2020-01-01']) {
    const current = { ...event, remainingPaymentDate };
    const payload = buildClientPaymentPayload(clientPaymentDraft(current), current);
    assert.equal(payload.billingStatus, 'partial70');
    assert.equal(payload.paidAmount, 157.5);
    assert.equal(payload.billingPaymentDate, null);
    assert.equal(clientPaymentSummary({ ...current, ...payload }).outstanding, 94.5);
  }
});

test('settlement stores cumulative receipts once and retains initial/payment schedule history', () => {
  const payload = buildClientPaymentPayload(paidDraft, event);
  assert.deepEqual(payload, { billingStatus: 'paid', paidAmount: 252, signaledAmount: 157.5,
    signaledAt: '2026-10-09', remainingPaymentDate: '2026-10-14', billingPaymentDate: '2026-10-14' });
  const settled = { ...event, ...payload };
  assert.deepEqual(clientPaymentSummary(settled), { total: 252, signal: 157.5, received: 252, remainingReceived: 94.5, outstanding: 0 });
  assert.deepEqual(buildClientPaymentPayload(clientPaymentDraft(settled), settled), payload, 'Repeated saving is idempotent');
});

test('effective date can differ from planned date and later edits do not erase the schedule', () => {
  const payload = buildClientPaymentPayload({ ...paidDraft, billingPaymentDate: '2026-10-16' }, event);
  assert.equal(payload.remainingPaymentDate, '2026-10-14');
  assert.equal(payload.billingPaymentDate, '2026-10-16');
  const edited = buildClientPaymentPayload({ ...paidDraft, signaledAmount: '150,00', remainingReceived: '102,00' }, { ...event, ...payload });
  assert.equal(edited.paidAmount, 252);
  assert.equal(edited.signaledAmount, 150);
  assert.equal(clientPaymentSummary({ ...event, ...edited }).remainingReceived, 102);
});

test('paid requires the exact total and an actual receipt date rather than a due date', () => {
  for (const remainingReceived of ['', '0', '90', '95', '-1', 'abc']) {
    assert.throws(() => buildClientPaymentPayload({ ...paidDraft, remainingReceived }, event), { statusCode: 422 });
  }
  assert.throws(() => buildClientPaymentPayload({ ...paidDraft, billingPaymentDate: '' }, event), /data efetiva/);
  assert.throws(() => buildClientPaymentPayload({ ...paidDraft, billingPaymentDate: '2026-02-30' }, event), /data efetiva/);
  assert.throws(() => buildClientPaymentPayload({ ...paidDraft, billingPaymentDate: '2026-10-08' }, event), /anterior/);
  assert.throws(() => buildClientPaymentPayload({ ...paidDraft, signaledAmount: '253' }, event), /exceder/);
});

test('cent-level decimals and payments with no signal remain exact', () => {
  const current = { totalRevenue: '1.234,56', billingStatus: 'pending', signaledAmount: 0, paidAmount: 0 };
  const result = buildClientPaymentPayload({ ...clientPaymentDraft(current), billingStatus: 'paid', remainingReceived: '1.234,56', billingPaymentDate: '2026-10-14' }, current);
  assert.equal(result.paidAmount, 1234.56);
  assert.equal(result.signaledAmount, 0);
  assert.equal(clientPaymentSummary({ ...current, ...result }).outstanding, 0);
});

test('legacy paid records remain readable and unknown dates are never invented', () => {
  for (const paidAmount of [0, 157.5, 252]) {
    const legacy = { ...event, billingStatus: 'paid', paidAmount, billingPaymentDate: null };
    const summary = clientPaymentSummary(legacy);
    assert.equal(summary.remainingReceived, 94.5);
    const payload = buildClientPaymentPayload(clientPaymentDraft(legacy), legacy);
    assert.equal(payload.billingPaymentDate, null);
    assert.equal(payload.signaledAt, '2026-10-09');
  }
  assert.equal(clientPaymentSummary({ ...event, billingStatus: 'paid', paidAmount: 200 }).outstanding, 52);
});

test('backend rejects inconsistent detailed receipts and keeps other callers compatible', () => {
  assert.throws(() => validateClientPaymentUpdate({ ...buildClientPaymentPayload(paidDraft, event), paidAmount: 200 }, event), { statusCode: 422 });
  assert.throws(() => validateClientPaymentUpdate({ ...buildClientPaymentPayload(paidDraft, event), billingPaymentDate: null }, event), { statusCode: 422 });
  assert.equal(validateClientPaymentUpdate({ billingStatus: 'paid', billingPaymentDate: '2026-10-14' }, event).paidAmount, 252);
  assert.equal(validateClientPaymentUpdate({ name: 'Editar evento', billingStatus: 'paid', paidAmount: 252 }, event), undefined);
});

test('finance paid summary counts the initial and final receipts as one total, not twice', () => {
  const settled = { ...event, ...buildClientPaymentPayload(paidDraft, event), id: 1, date: '2026-10-09', clientId: 1 };
  const summary = buildClientFinancialSummary({ events: [settled], period: '2026-10', clients: [{ id: 1, name: 'QA' }],
    invoices: [{ id: 10, eventId: 1, clientId: 1, status: 'paid', issueDate: '2026-10-14', total: 252 }] });
  assert.equal(summary[0].received, 252);
  assert.equal(summary[0].billedOpen, 0);
  assert.equal(summary[0].total, 252);
});

test('signal value and dates can be corrected before settlement without changing the service total', () => {
  const wrong = { ...event, signaledAmount: 175.5, paidAmount: 175.5 };
  const corrected = buildClientPaymentPayload({ ...clientPaymentDraft(wrong), signaledAmount: '157,50',
    signaledAt: '2026-10-10', remainingPaymentDate: '2026-10-20' }, wrong);
  assert.equal(corrected.paidAmount, 157.5);
  assert.equal(corrected.signaledAmount, 157.5);
  assert.equal(corrected.signaledAt, '2026-10-10');
  assert.equal(corrected.remainingPaymentDate, '2026-10-20');
  assert.equal(clientPaymentSummary({ ...wrong, ...corrected }).outstanding, 94.5);
  assert.equal(wrong.totalRevenue, 252);
});

test('reversal removes only an isolated signal and derives pending/invoiced from existing financial evidence', () => {
  assert.deepEqual(buildClientSignalReversal(event), { billingStatus: 'pending', signaledAmount: 0, paidAmount: 0, signaledAt: null });
  assert.equal(buildClientSignalReversal(event, [{ status: 'issued', issueDate: '2026-10-09' }]).billingStatus, 'invoiced');
  assert.equal(buildClientSignalReversal({ ...event, billingStatus: 'invoiced' }).billingStatus, 'invoiced');
  assert.equal(buildClientSignalReversal(event, [{ status: 'cancelled', issueDate: '2026-10-09' }]).billingStatus, 'pending');
  assert.equal(clientPaymentSummary({ ...event, ...buildClientSignalReversal(event) }).outstanding, 252);
  assert.equal(event.signaledAmount, 157.5);
});

test('paid/legacy settlement, later receipts, paid invoices and actual settlement dates block signal reversal', () => {
  for (const patch of [{ billingStatus: 'paid', paidAmount: 252 }, { billingStatus: 'paid', paidAmount: 0 },
    { paidAmount: 200 }, { paidAmount: 100 }, { billingPaymentDate: '2026-10-14' }, { signaledAmount: 0 }]) {
    assert.notEqual(clientSignalReversalBlocker({ ...event, ...patch }), '');
    assert.throws(() => buildClientSignalReversal({ ...event, ...patch }), { statusCode: 422 });
  }
  assert.throws(() => buildClientSignalReversal(event, [{ status: 'paid', issueDate: '2026-10-14' }]), { statusCode: 422 });
});

test('generic payment corrections cannot erase a later receipt or initial paid history', () => {
  const settled = { ...event, ...buildClientPaymentPayload(paidDraft, event) };
  for (const input of [{ paidAmount: 0 }, { signaledAmount: 0 }, { signaledAt: null }]) {
    assert.throws(() => assertClientSignalHistoryPreserved(input, settled), { statusCode: 422 });
  }
  assert.throws(() => validateClientPaymentUpdate({ billingStatus: 'partial70', signaledAmount: 157.5,
    paidAmount: 157.5, signaledAt: '2026-10-09', remainingPaymentDate: '2026-10-14', billingPaymentDate: null }, settled), { statusCode: 422 });
  assert.doesNotThrow(() => assertClientSignalHistoryPreserved({ signaledAmount: 150, paidAmount: 252 }, settled));
});

test('editing the dates of a partial signal preserves an additional received parcel and its outstanding balance', () => {
  const later = { ...event, paidAmount: 200 };
  const payload = buildClientPaymentPayload({ ...clientPaymentDraft(later), remainingPaymentDate: '2026-10-20' }, later);
  assert.equal(payload.paidAmount, 200);
  assert.equal(payload.signaledAmount, 157.5);
  assert.equal(clientPaymentSummary({ ...later, ...payload }).outstanding, 52);
  assert.throws(() => buildClientSignalReversal(later), { statusCode: 422 });
});

test('explicit receipt reversal corrects simulated settlement without changing service money or the simple reversal guard', () => {
  const simulated = { ...event, totalRevenue: 1252.14, billingStatus: 'pending', signaledAmount: 816.23,
    paidAmount: 1166.04, billingPaymentDate: '2026-07-27' };
  const confirmation = { confirmedReceived: 1166.04, confirmedSignal: 816.23 };
  assert.throws(() => buildClientSignalReversal(simulated), { statusCode: 422 });
  const reversed = buildClientReceiptReversal(simulated, [], confirmation);
  assert.deepEqual(reversed, { billingStatus: 'pending', signaledAmount: 0, paidAmount: 0, signaledAt: null, billingPaymentDate: null });
  assert.equal(clientPaymentSummary({ ...simulated, ...reversed }).outstanding, 1252.14);
  for (const patch of [{}, { confirmedReceived: 816.23, confirmedSignal: 816.23 },
    { confirmedReceived: 1166.04, confirmedSignal: 0 }, { confirmedReceived: -1, confirmedSignal: 816.23 }]) {
    assert.throws(() => buildClientReceiptReversal(simulated, [], patch), { statusCode: 422 });
  }
  for (const status of ['issued', 'paid', 'settled', 'regularized']) {
    assert.throws(() => buildClientReceiptReversal(simulated, [{ status, issueDate: '2026-10-01' }], confirmation), /faturação emitida/);
  }
  assert.throws(() => buildClientReceiptReversal({ ...simulated, billingStatus: 'invoiced' }, [], confirmation), /faturação emitida/);
  assert.doesNotThrow(() => buildClientReceiptReversal(simulated, [{ status: 'draft' }], confirmation));
  assert.equal(simulated.paidAmount, 1166.04);
});

test('receipt reversal supports paid legacy snapshots and payments without a signal but rejects empty receipts', () => {
  const legacy = { ...event, billingStatus: 'paid', paidAmount: 0 };
  assert.equal(buildClientReceiptReversal(legacy, [], { confirmedReceived: 252, confirmedSignal: 157.5 }).billingStatus, 'pending');
  assert.equal(buildClientReceiptReversal({ ...event, signaledAmount: 0, paidAmount: 252 }, [],
    { confirmedReceived: 252, confirmedSignal: 0 }).paidAmount, 0);
  assert.throws(() => buildClientReceiptReversal({ billingStatus: 'pending' }, [], { confirmedReceived: 0, confirmedSignal: 0 }), /não tem recebimentos/);
});
