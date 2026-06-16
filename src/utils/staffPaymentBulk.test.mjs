import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMoveToPaidPayload,
  buildStaffPaymentStatusPayload,
} from './staffPaymentBulk.js';

test('move to paid always sends the paid status even when current draft is awaiting RV', () => {
  assert.deepEqual(buildMoveToPaidPayload({
    paymentStatus: 'awaiting_data',
    paymentDate: '',
    paymentAdjustment: '+2,50',
    paymentDeferredMonth: '2026-08',
  }, '2026-06-16'), {
    paymentStatus: 'paid',
    paymentDate: '2026-06-16',
    paymentAdjustment: 2.5,
    paymentDeferredMonth: '2026-08',
  });
});

test('bulk paid update fills today when payment date is empty', () => {
  assert.deepEqual(buildStaffPaymentStatusPayload({
    paymentStatus: 'paid',
    paymentDate: '',
    paymentAdjustment: '-2,43',
  }, '2026-06-16'), {
    paymentStatus: 'paid',
    paymentDate: '2026-06-16',
    paymentAdjustment: -2.43,
  });
});

test('bulk non-paid update clears payment date', () => {
  assert.deepEqual(buildStaffPaymentStatusPayload({
    paymentStatus: 'awaiting_data',
    paymentDate: '2026-06-16',
    paymentAdjustment: 0,
  }, '2026-06-16'), {
    paymentStatus: 'awaiting_data',
    paymentDate: null,
    paymentAdjustment: 0,
  });
});
