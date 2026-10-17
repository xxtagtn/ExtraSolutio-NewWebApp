import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPaymentAdjustment, paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { clientPaymentRecordPatch } from '../../server/services/clientPaymentRecord.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { buildAdditionalClientPayment, clientPaymentSummary } from './clientPayment.js';
import { normalizeExternalCosts } from './externalCosts.js';

function settled(event) {
  const before = { billingStatus: 'partial70', paidAmount: 200, signaledAmount: 200, signaledAt: '2026-10-16', ...event };
  const patch = { paidAmount: Number(event.totalRevenue), billingStatus: 'paid', billingPaymentDate: '2026-10-20' };
  return { ...before, ...patch, ...clientPaymentRecordPatch(before, patch) };
}

const partners = normalizeExternalCosts([
  { id: 'flowers', type: 'Outro', supplier: 'Flores', costAmount: 500, marginPercent: 10, vatType: 'standard_23' },
  { id: 'napkins', type: 'Material', costAmount: 300, marginPercent: 10, vatType: 'standard_23' },
]);

test('real regression: 1392.36 advance -> 28 base + 6.44 VAT -> 34.44 receipt, immutable history', () => {
  const paid = settled({ totalRevenue: 1392.36, taxAmount: 260.36, staffVatRateSnapshot: 23, externalCosts: partners });
  const original = readClientPaymentRecord(paid.clientPaymentRecord);
  const event = { ...paid, totalRevenue: 1426.8, taxAmount: 266.8 };
  const breakdown = clientPaymentAdjustment(event, clientPaymentSummary(event).received);
  assert.deepEqual([breakdown.base, breakdown.tax, breakdown.total, breakdown.outstanding], [28, 6.44, 34.44, 34.44]);
  assert.deepEqual(breakdown.components.map((row) => [row.label, row.base, row.tax, row.rate]), [['Staff', 28, 6.44, '23']]);
  const patch = buildAdditionalClientPayment(event, { amount: '34,44', receivedAt: '2026-10-21' });
  const received = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch, { type: 'adjustment' }) };
  const record = readClientPaymentRecord(received.clientPaymentRecord);
  assert.deepEqual(record.entries.slice(0, 2), original.entries);
  assert.deepEqual(record.entries.map((row) => row.amount), [200, 1192.36, 34.44]);
  assert.deepEqual(record.entries[2].financialAdjustment, breakdown);
  assert.equal(clientPaymentSummary(received).received, 1426.8);
  assert.equal(clientPaymentSummary(received).outstanding, 0);
  assert.equal(clientPaymentAdjustment(received, 1426.8), null);
  assert.deepEqual(clientPaymentRecordPatch(received, {}), {});
});

test('mixed and exempt components use actual tax deltas, not gross / 1.23', () => {
  const paid = settled({ totalRevenue: 300, taxAmount: 0, staffVatRateSnapshot: 0, externalCosts: [] });
  const externalCosts = normalizeExternalCosts([
    { id: 'exempt', type: 'Outro', costAmount: 50, vatType: 'exempt' },
    { id: 'standard', type: 'Outro', costAmount: 100, vatType: 'standard_23' },
    { id: 'catering', type: 'Catering', costAmount: 100, vatType: 'catering' },
  ]);
  const next = { ...paid, totalRevenue: 587.5, taxAmount: 37.5, externalCosts };
  const result = clientPaymentAdjustment(next, 300);
  assert.equal(result.base, 250); assert.equal(result.tax, 37.5); assert.equal(result.total, 287.5);
  assert.deepEqual(result.components.map((row) => [row.base, row.tax, row.rate]), [[50, 0, '0'], [100, 23, '23'], [100, 14.5, '13% / 23%']]);
  const exempt = clientPaymentAdjustment({ ...paid, totalRevenue: 328 }, 300);
  assert.equal(exempt.base, 28); assert.equal(exempt.tax, 0); assert.equal(exempt.total, 28);
});

test('partial additional receipts keep the full real breakdown separate from outstanding, without allocating VAT arbitrarily', () => {
  const paid = settled({ totalRevenue: 123, taxAmount: 23, staffVatRateSnapshot: 23 });
  let event = { ...paid, totalRevenue: 246, taxAmount: 46 };
  const patch = buildAdditionalClientPayment(event, { amount: 50, receivedAt: '2026-10-21' });
  event = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch, { type: 'adjustment' }) };
  const result = clientPaymentAdjustment(event, 173);
  assert.deepEqual([result.base, result.tax, result.total, result.receivedTowards, result.outstanding], [100, 23, 123, 50, 73]);
  const finish = buildAdditionalClientPayment(event, { amount: 73, receivedAt: '2026-10-22' });
  const final = { ...event, ...finish, ...clientPaymentRecordPatch(event, finish, { type: 'adjustment' }) };
  assert.equal(readClientPaymentRecord(final.clientPaymentRecord).entries.at(-1).financialAdjustment.receivedTowards, 50);
  assert.equal(clientPaymentSummary(final).outstanding, 0);
});

test('legacy records only gain a reliable reference before totals change; unknown old VAT is never invented', () => {
  const record = { version: 1, expectedTotal: 123, entries: [{ id: 'old', type: 'remaining', amount: 123 }] };
  const paid = { totalRevenue: 123, taxAmount: 23, paidAmount: 123, billingStatus: 'paid', clientPaymentRecord: JSON.stringify(record) };
  const patch = clientPaymentRecordPatch(paid, { totalRevenue: 157.44, taxAmount: 29.44 });
  const next = { ...paid, totalRevenue: 157.44, taxAmount: 29.44, ...patch };
  assert.equal(clientPaymentAdjustment(next, 123).base, 28);
  assert.deepEqual(readClientPaymentRecord(next.clientPaymentRecord).entries, record.entries);
  assert.deepEqual(clientPaymentAdjustment({ ...paid, totalRevenue: 157.44, taxAmount: 29.44 }, 123), { available: false });
  assert.equal(paymentFinancialSnapshot({ totalRevenue: 123 }), null);
});

test('second adjustment has a new settled reference, keeps first receipt detail and respects cent rounding', () => {
  let event = settled({ totalRevenue: 123, taxAmount: 23, staffVatRateSnapshot: 23 });
  event = { ...event, totalRevenue: 123.12, taxAmount: 23.02 };
  const patch = buildAdditionalClientPayment(event, { amount: 0.12, receivedAt: '2026-10-21' });
  event = { ...event, ...patch, ...clientPaymentRecordPatch(event, patch, { type: 'adjustment' }) };
  const first = readClientPaymentRecord(event.clientPaymentRecord).entries.at(-1);
  const next = { ...event, totalRevenue: 157.56, taxAmount: 29.46 };
  const result = clientPaymentAdjustment(next, 123.12);
  assert.deepEqual([result.base, result.tax, result.total], [28, 6.44, 34.44]);
  assert.deepEqual(readClientPaymentRecord(next.clientPaymentRecord).entries.at(-1), first);
  assert.equal(clientPaymentAdjustment({ ...next, totalRevenue: 100 }, 123.12), null);
});
