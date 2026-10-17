import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptFiscal, clientReceiptTaxSummary, reconcileReceiptRounding } from './clientReceiptTax.js';
import { paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { clientPaymentRecordPatch } from '../../server/services/clientPaymentRecord.js';
import { receiptMovements, receiptCanDelete } from './clientReceiptMovements.js';

test('uniform event: 800 base + 184 VAT; 799.50 received is 650 base + 149.50 VAT', () => {
  const event = { totalRevenue: 984, taxAmount: 184, staffVatRateSnapshot: 23, externalCosts: [] };
  const snapshot = paymentFinancialSnapshot(event), fiscal = receiptFiscal(snapshot, 799.5);
  assert.deepEqual([fiscal.base, fiscal.tax], [650, 149.5]);
  const record = { version: 1, entries: [{ id: 'signal', type: 'signal', amount: 799.5, fiscal }] };
  const summary = clientReceiptTaxSummary({ ...event, clientPaymentRecord: record }, 799.5);
  assert.deepEqual([summary.outstanding.base, summary.outstanding.tax, summary.outstanding.total], [150, 34.5, 184.5]);
});

test('mixed components: no proportional allocation; exact selected components determine the receipt VAT', () => {
  const snapshot = { total: 223, base: 200, tax: 23, components: [
    { key: 'staff', base: 100, tax: 23, rate: '23' }, { key: 'partner', base: 100, tax: 0, rate: '0' },
  ] };
  assert.equal(receiptFiscal(snapshot, 150), null);
  const fiscal = receiptFiscal(snapshot, 150, [{ key: 'staff', amount: 123 }, { key: 'partner', amount: 27 }]);
  assert.deepEqual([fiscal.base, fiscal.tax], [127, 23]);
  for (const allocations of [[null], [{ key: 'foreign', amount: 150 }], [{ key: 'staff', amount: -10 }],
    [{ key: 'staff', amount: 100 }, { key: 'staff', amount: 50 }], [{ key: 'staff', amount: 149 }]]) {
    assert.equal(receiptFiscal(snapshot, 150, allocations), null);
  }
});

test('exempt and catering components keep the existing treatment, not a fixed 23 percent', () => {
  assert.equal(receiptFiscal({ total: 500, base: 500, tax: 0, components: [] }, 50).base, 50);
  const catering = { total: 114.5, base: 100, tax: 14.5, components: [{ key: 'catering', rate: '13% / 23%', base: 100, tax: 14.5 }] };
  assert.deepEqual([receiptFiscal(catering, 57.25).base, receiptFiscal(catering, 57.25).tax], [50, 7.25]);
});

test('immutable projection applies linked edits/reversals without replacing the originals', () => {
  const original = { id: 'a', type: 'signal', amount: 200, receivedAt: '2026-10-16' };
  const record = { version: 1, entries: [original,
    { id: 'b', type: 'remaining', amount: 1192.36 },
    { id: 'edit', operation: 'edit', targetId: 'b', amount: 7.64, replacement: { type: 'remaining', amount: 1200 } },
    { id: 'reverse', operation: 'reverse', targetId: 'a', amount: -200, recordedAt: '2026-10-26' },
  ] };
  const projection = receiptMovements(record);
  assert.equal(projection.reliable, true); assert.equal(projection.total, 1200);
  assert.equal(projection.rows[0].voided, 'reverse'); assert.deepEqual(record.entries[0], original);
  assert.equal(receiptMovements({ version: 1, entries: [original, { type: 'correction', amount: -20 }] }).reliable, false);
});

test('a full reversal preserves past receipts, and a new signal starts a new active movement', () => {
  const record = { version: 1, entries: [{ id: 'a', type: 'signal', amount: 200 }, { id: 'r', type: 'reversal', amount: -200 }, { id: 'b', type: 'signal', amount: 100 }] };
  assert.equal(receiptMovements(record).total, 100); assert.equal(receiptMovements(record).rows[0].voided, 'reverse');
});

test('recording a forecast or refreshing totals never adds a received movement', () => {
  const event = { billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, totalRevenue: 984, taxAmount: 184, staffVatRateSnapshot: 23 };
  assert.deepEqual(clientPaymentRecordPatch(event, { totalRevenue: 1107, taxAmount: 207 }), {});
  const partial = { billingStatus: 'partial70', paidAmount: 799.5, signaledAmount: 799.5, signaledAt: '2026-10-16' };
  const saved = { ...event, ...partial, ...clientPaymentRecordPatch(event, partial) };
  assert.equal(receiptMovements(saved.clientPaymentRecord).rows.length, 1);
  assert.deepEqual(clientPaymentRecordPatch(saved, { totalRevenue: 1107, taxAmount: 207 }), {});
});

test('last uniform receipt absorbs a rounding cent without rewriting an earlier receipt', () => {
  let event = { billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, totalRevenue: 0.04, taxAmount: 0.01, staffVatRateSnapshot: 23 };
  let patch = { billingStatus: 'partial70', paidAmount: 0.02, signaledAmount: 0.02, signaledAt: '2026-10-16' };
  event = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch) };
  const first = receiptMovements(event.clientPaymentRecord).rows[0];
  patch = { billingStatus: 'paid', paidAmount: 0.04, billingPaymentDate: '2026-10-20' };
  event = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch) };
  const rows = receiptMovements(event.clientPaymentRecord).rows;
  assert.deepEqual(rows[0], first);
  assert.deepEqual(rows.map((row) => [row.fiscal.base, row.fiscal.tax]), [[0.02, 0], [0.01, 0.01]]);
  assert.deepEqual(clientReceiptTaxSummary(event, 0.04).outstanding, { base: 0, tax: 0, total: 0 });
  const snapshot = { total: 223, base: 200, tax: 23, components: [{ rate: '23', base: 100, tax: 23 }, { rate: '0', base: 100, tax: 0 }] };
  const fiscal = { base: 100, tax: 23, total: 123 };
  assert.equal(reconcileReceiptRounding(snapshot, fiscal, [{ amount: 100, fiscal: { base: 100, tax: 0, total: 100 } }]), fiscal);
});

test('an edited unknown legacy receipt cannot borrow a coincidentally matching old fiscal reference', () => {
  const event = { totalRevenue: 984, taxAmount: 184, staffVatRateSnapshot: 23,
    clientPaymentRecord: { version: 1, settledFinancials: { total: 799.5, base: 650, tax: 149.5 }, entries: [
      { id: 'a', type: 'signal', amount: 700 },
      { id: 'b', operation: 'edit', targetId: 'a', amount: 99.5, replacement: { amount: 799.5, type: 'signal' } },
    ] } };
  assert.equal(clientReceiptTaxSummary(event, 799.5).received, null);
});

test('reversing a legacy signal retains base and VAT of the untouched remaining receipt', () => {
  const event = { totalRevenue: 364.08, taxAmount: 68.08, staffVatRateSnapshot: 23 };
  const reference = paymentFinancialSnapshot(event);
  const record = { version: 1, settledFinancials: reference, entries: [
    { id: 'signal', type: 'signal', source: 'legacy', amount: 123 },
    { id: 'remaining', type: 'remaining', source: 'legacy', amount: 241.08 },
    { id: 'reverse', operation: 'reverse', targetId: 'signal', amount: -123 },
  ] };
  const original = JSON.stringify(record);
  const summary = clientReceiptTaxSummary({ ...event, clientPaymentRecord: record }, 241.08);
  assert.deepEqual(summary.received, { base: 196, tax: 45.08, total: 241.08 });
  assert.deepEqual(summary.outstanding, { base: 100, tax: 23, total: 123 });
  assert.equal(JSON.stringify(record), original, 'Consultation never rewrites the audit');
});

test('reversing all receipts preserves total VAT and presents zero received rather than missing values', () => {
  const event = { totalRevenue: 364.08, taxAmount: 68.08, staffVatRateSnapshot: 23,
    clientPaymentRecord: { version: 1, entries: [
      { id: 'signal', type: 'signal', amount: 123 },
      { id: 'reverse', operation: 'reverse', targetId: 'signal', amount: -123 },
    ] } };
  const summary = clientReceiptTaxSummary(event, 0);
  assert.deepEqual(summary.received, { base: 0, tax: 0, total: 0 });
  assert.deepEqual(summary.outstanding, { base: 296, tax: 68.08, total: 364.08 });
});

test('reversal never invents allocation of an unknown legacy mixed-tax partial receipt', () => {
  const event = { totalRevenue: 223, taxAmount: 23, staffVatRateSnapshot: 23,
    clientPaymentRecord: { version: 1, settledFinancials: { total: 223, base: 200, tax: 23, components: [
      { key: 'staff', rate: '23', base: 100, tax: 23 }, { key: 'partner', rate: '0', base: 100, tax: 0 },
    ] }, entries: [
      { id: 'signal', type: 'signal', amount: 100 }, { id: 'remaining', type: 'remaining', amount: 123 },
      { id: 'reverse', operation: 'reverse', targetId: 'signal', amount: -100 },
    ] } };
  assert.equal(clientReceiptTaxSummary(event, 123).received, null);
});

test('deleting an individually reversed receipt is a zero-value audit operation', () => {
  const entries = [{ id: 'a', type: 'signal', amount: 123 }, { id: 'b', type: 'remaining', amount: 241.08 },
    { id: 'r', operation: 'reverse', targetId: 'a', amount: -123, recordedAt: '2026-10-16T12:00:00Z' }];
  const record = { version: 1, entries };
  assert.equal(receiptCanDelete(record, receiptMovements(record).rows[0]), true);
  const deleted = { version: 1, entries: [...entries, { id: 'd', operation: 'delete', targetId: 'a', amount: 0, recordedAt: '2026-10-16T13:00:00Z' }] };
  const result = receiptMovements(deleted);
  assert.equal(result.reliable, true); assert.equal(result.total, 241.08);
  assert.equal(result.rows[0].voided, 'delete'); assert.equal(result.rows[0].voidedAt, '2026-10-16T12:00:00Z');
  assert.equal(result.rows[0].deletedAt, '2026-10-16T13:00:00Z');
  assert.equal(receiptCanDelete(deleted, result.rows[0]), false);
  assert.deepEqual(deleted.entries.slice(0, 3), entries);
});

test('deleting a globally reversed receipt preserves a subsequent active signal', () => {
  const record = { version: 1, entries: [{ id: 'a', type: 'signal', amount: 690.52 },
    { id: 'b', type: 'remaining', amount: 295.94 }, { id: 'r', type: 'reversal', amount: -986.46 },
    { id: 'c', type: 'signal', amount: 100 }, { id: 'd', operation: 'delete', targetId: 'a', amount: 0 }] };
  const projection = receiptMovements(record);
  assert.equal(projection.reliable, true); assert.equal(projection.total, 100);
  assert.deepEqual(projection.rows.map((row) => row.voided || null), ['delete', 'reverse', null]);
});

test('a second subtraction or edit of a reversed receipt is not a valid journal operation', () => {
  for (const operation of ['delete', 'reverse', 'edit']) {
    const record = { version: 1, entries: [{ id: 'a', type: 'signal', amount: 123 },
      { id: 'r', operation: 'reverse', targetId: 'a', amount: -123 },
      { id: 'invalid', operation, targetId: 'a', amount: -123, replacement: { amount: 0 } }] };
    assert.equal(receiptMovements(record).reliable, false);
  }
});
