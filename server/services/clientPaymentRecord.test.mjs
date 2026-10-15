import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { buildAdditionalClientPayment, buildClientPaymentPayload, clientPaymentDraft, clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { clientPaymentAssessment, readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { layoutPaymentReminders } from '../../src/utils/layoutNotifications.js';

const base = { totalRevenue: 986.46, billingStatus: 'partial70', signaledAmount: 690.52, paidAmount: 690.52,
  signaledAt: '2026-10-15', billingPaymentDate: null };
test('receipt record preserves the original signal, remaining payment and final adjustment as separate immutable entries', () => {
  const payment = { billingStatus: 'paid', paidAmount: 986.46, billingPaymentDate: '2026-11-08' };
  const paid = { ...base, ...payment, ...clientPaymentRecordPatch(base, payment) };
  const original = readClientPaymentRecord(paid.clientPaymentRecord);
  assert.deepEqual(original.entries.map((entry) => entry.amount), [690.52, 295.94]);
  assert.deepEqual(original.entries.map((entry) => entry.receivedAt), ['2026-10-15', '2026-11-08']);
  assert.deepEqual(clientPaymentRecordPatch(paid, { totalRevenue: 1050 }), {});
  const updated = { ...paid, totalRevenue: 1050 };
  const additional = buildAdditionalClientPayment(updated, { amount: '63,54', receivedAt: '2026-11-16' });
  const settled = { ...updated, ...additional, ...clientPaymentRecordPatch(updated, additional, { type: 'adjustment' }) };
  const history = readClientPaymentRecord(settled.clientPaymentRecord);
  assert.deepEqual(history.entries.slice(0, 2), original.entries);
  assert.equal(history.entries[2].amount, 63.54); assert.equal(history.expectedTotal, 986.46);
  assert.equal(clientPaymentSummary(settled).received, 1050);
  assert.equal(clientPaymentSummary(settled).outstanding, 0);
});
test('implicit old paid amounts materialize against the old total, never the recalculated total', () => {
  for (const paidAmount of [0, 690.52]) {
    const old = { ...base, billingStatus: 'paid', paidAmount, billingPaymentDate: null };
    const patch = clientPaymentRecordPatch(old, { totalRevenue: 1016.46 });
    assert.equal(patch.paidAmount, 986.46);
    assert.equal(clientPaymentSummary({ ...old, totalRevenue: 1016.46, ...patch }).outstanding, 30);
    assert.equal(readClientPaymentRecord(patch.clientPaymentRecord).entries[1].receivedAt, null);
  }
});
test('changing payment label after settlement preserves the already received 30 percent and actual date', () => {
  const paid = { ...base, billingStatus: 'paid', paidAmount: 986.46, billingPaymentDate: '2026-11-08' };
  const draft = { ...clientPaymentDraft(paid), billingStatus: 'partial70' };
  const payload = buildClientPaymentPayload(draft, paid);
  assert.equal(payload.paidAmount, 986.46); assert.equal(payload.billingPaymentDate, '2026-11-08');
  const lowered = { ...paid, totalRevenue: 950 };
  assert.equal(clientPaymentAssessment(lowered, clientPaymentSummary(lowered)).excess, 36.46);
  assert.equal(buildClientPaymentPayload(clientPaymentDraft(lowered), lowered).paidAmount, 986.46);
});
test('additional receipts validate amounts and dates, and journal corrections never discard old entries', () => {
  const paid = { ...base, billingStatus: 'paid', paidAmount: 986.46, billingPaymentDate: '2026-11-08', totalRevenue: 1016.46 };
  for (const input of [{ amount: 0, receivedAt: '2026-11-16' }, { amount: 31, receivedAt: '2026-11-16' },
    { amount: 30, receivedAt: '' }, { amount: 30, receivedAt: '2026-11-01' }]) {
    assert.throws(() => buildAdditionalClientPayment(paid, input), { statusCode: 422 });
  }
  const initial = { ...paid, ...clientPaymentRecordPatch(paid) };
  const reversal = { billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, billingPaymentDate: null, signaledAt: null };
  const patch = clientPaymentRecordPatch(initial, reversal, { type: 'reversal' });
  assert.deepEqual(readClientPaymentRecord(patch.clientPaymentRecord).entries.slice(0, 2), readClientPaymentRecord(initial.clientPaymentRecord).entries);
  assert.equal(readClientPaymentRecord(patch.clientPaymentRecord).entries.at(-1).amount, -986.46);
  assert.throws(() => clientPaymentRecordPatch({ ...paid, clientPaymentRecord: 'invalid' }), { statusCode: 422 });
});

test('legacy explicit invoice closure remains independent of receipt status after settlement', () => {
  const invoiced = { ...base, billingStatus: 'invoiced' };
  const patch = clientPaymentRecordPatch(invoiced, { billingStatus: 'paid', paidAmount: 986.46 }, { legacyInvoiced: true });
  assert.equal(readClientPaymentRecord(patch.clientPaymentRecord).legacyInvoiced, true);
  assert.equal(clientPaymentSummary({ ...invoiced, billingStatus: 'paid', paidAmount: 986.46, ...patch }).received, 986.46);
});

test('a paid forecast never regenerates the original remaining-payment reminder', () => {
  const event = { ...base, totalRevenue: 986.46, paidAmount: 986.46, remainingPaymentDate: '2026-11-08' };
  assert.equal(layoutPaymentReminders([event], new Date('2026-11-08T12:00:00Z')).length, 0);
  assert.equal(layoutPaymentReminders([{ ...event, paidAmount: 690.52 }], new Date('2026-11-08T12:00:00Z')).length, 1);
});
