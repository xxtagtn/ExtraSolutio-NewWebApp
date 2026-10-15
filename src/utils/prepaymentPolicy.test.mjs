import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPrepaymentSummary,
  defaultPrepaymentRemainingDate,
  prepaymentRemainingReminderDate,
  prepaymentDepositAmount,
  prepaymentReferenceAmounts,
  shouldBlockPrepaidStaffAllocation,
} from './prepaymentPolicy.js';

test('blocks prepaid clients only while no signal or payment is registered', () => {
  assert.equal(shouldBlockPrepaidStaffAllocation({ billingMethod: 'prepaid' }, 'pending'), true);
  assert.equal(shouldBlockPrepaidStaffAllocation({ billingMethod: 'prepaid' }, 'partial70'), true);
  assert.equal(shouldBlockPrepaidStaffAllocation({ billingMethod: 'prepaid' }, 'partial70', '700,00 EUR'), false);
  assert.equal(shouldBlockPrepaidStaffAllocation({ billingMethod: 'prepaid' }, 'paid'), false);
  assert.equal(shouldBlockPrepaidStaffAllocation({ billingMethod: 'per_event' }, 'pending'), false);
});

test('calculates the usual 70 percent prepayment amount', () => {
  assert.equal(prepaymentDepositAmount(1000), 700);
  assert.equal(prepaymentDepositAmount('284,50'), 199.15);
  assert.equal(prepaymentDepositAmount(1000, { prepaymentPercent: 50 }), 500);
});

test('read-only 70/30 references match the requested totals without changing configured policies', () => {
  for (const [total, seventy, thirty] of [[100, 70, 30], [252, 176.4, 75.6], [790, 553, 237], [1000, 700, 300]]) {
    assert.deepEqual(prepaymentReferenceAmounts(total), { total, seventy, thirty });
  }
  assert.deepEqual(prepaymentReferenceAmounts('1.000,00 €'), { total: 1000, seventy: 700, thirty: 300 });
  assert.equal(prepaymentDepositAmount(1000, { prepaymentPercent: 50 }), 500);
});

test('70/30 monetary references sum exactly in cents, including half-cent rounding', () => {
  for (const [total, seventy, thirty] of [[0.01, 0.01, 0], [0.05, 0.04, 0.01], [2.15, 1.51, 0.64], [6.55, 4.59, 1.96]]) {
    assert.deepEqual(prepaymentReferenceAmounts(total), { total, seventy, thirty });
  }
  for (let totalCents = 0; totalCents <= 100000; totalCents += 1) {
    const split = prepaymentReferenceAmounts(totalCents / 100);
    assert.equal(Math.round(split.seventy * 100) + Math.round(split.thirty * 100), totalCents);
    assert.equal(Math.round(split.seventy * 100), Math.floor((totalCents * 70 + 50) / 100));
  }
});

test('references are recalculated from the supplied current total and never mutate payment data', () => {
  const event = { totalRevenue: 252, signaledAmount: 157.5, paidAmount: 157.5, billingStatus: 'partial70',
    signaledAt: '2026-10-09', billingPaymentDate: null, remainingPaymentDate: '2026-10-14' };
  const snapshot = structuredClone(event);
  assert.equal(prepaymentReferenceAmounts(event.totalRevenue).seventy, 176.4);
  assert.deepEqual(event, snapshot);
  assert.deepEqual(prepaymentReferenceAmounts(790), { total: 790, seventy: 553, thirty: 237 });
  assert.deepEqual(prepaymentReferenceAmounts(null), { total: 0, seventy: 0, thirty: 0 });
});

test('uses one week before the service date as the remaining payment date', () => {
  assert.equal(defaultPrepaymentRemainingDate('2026-11-21'), '2026-11-14');
  assert.equal(defaultPrepaymentRemainingDate('2026-11-21', 10), '2026-11-11');
});

test('builds an automatic prepayment summary with signal, missing value and alert date', () => {
  assert.deepEqual(buildPrepaymentSummary({
    total: '1000,00 EUR',
    serviceDate: '2026-11-21',
    billingStatus: 'pending',
  }), {
    total: 1000,
    status: 'pending',
    signaledAmount: 700,
    paidAmount: 0,
    remainingAmount: 1000,
    remainingPaymentDate: '2026-11-14',
  });

  assert.deepEqual(buildPrepaymentSummary({
    total: '1000,00 EUR',
    serviceDate: '2026-11-21',
    billingStatus: 'partial70',
    client: { prepaymentPercent: 50, prepaymentRemainingDaysBefore: 10 },
  }), {
    total: 1000,
    status: 'partial70',
    signaledAmount: 500,
    paidAmount: 500,
    remainingAmount: 500,
    remainingPaymentDate: '2026-11-11',
  });
});

test('resolves the remaining prepayment reminder date from manual date or client rule', () => {
  assert.equal(prepaymentRemainingReminderDate({
    remainingPaymentDate: '2026-11-10T00:00:00.000Z',
    date: '2026-11-21',
    client: { prepaymentRemainingDaysBefore: 7 },
  }), '2026-11-10');

  assert.equal(prepaymentRemainingReminderDate({
    date: '2026-11-21',
    client: { prepaymentRemainingDaysBefore: 10 },
  }), '2026-11-11');
});

test('preserves a manually registered signal and remaining payment date', () => {
  assert.deepEqual(buildPrepaymentSummary({
    total: 1000,
    serviceDate: '2026-11-21',
    billingStatus: 'partial70',
    signaledAmount: '350,50',
    paidAmount: '350,50',
    remainingPaymentDate: '2026-11-20',
  }), {
    total: 1000,
    status: 'partial70',
    signaledAmount: 350.5,
    paidAmount: 350.5,
    remainingAmount: 649.5,
    remainingPaymentDate: '2026-11-20',
  });
});

test('prepaid summaries keep the actual received total when the final price grows or shrinks', () => {
  for (const billingStatus of ['paid', 'partial70']) {
    const summary = buildPrepaymentSummary({ total: 1016.46, billingStatus, signaledAmount: 690.52, paidAmount: 986.46 });
    assert.equal(summary.paidAmount, 986.46); assert.equal(summary.remainingAmount, 30);
    const excess = buildPrepaymentSummary({ total: 950, billingStatus, signaledAmount: 690.52, paidAmount: 986.46 });
    assert.equal(excess.paidAmount, 986.46); assert.equal(excess.remainingAmount, 0);
  }
});
