import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPrepaymentSummary,
  defaultPrepaymentRemainingDate,
  prepaymentDepositAmount,
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
});

test('uses one week before the service date as the remaining payment date', () => {
  assert.equal(defaultPrepaymentRemainingDate('2026-11-21'), '2026-11-14');
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
  }), {
    total: 1000,
    status: 'partial70',
    signaledAmount: 700,
    paidAmount: 700,
    remainingAmount: 300,
    remainingPaymentDate: '2026-11-14',
  });
});
