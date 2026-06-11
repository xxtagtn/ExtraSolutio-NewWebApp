import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFinanceReadyEvent } from './financeReadiness.js';

test('includes an event explicitly marked as having validated hours', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    notes: '[EVENT_VALIDATED_HOURS] 2026-06-03T12:00:00.000Z',
    assignments: [],
  }), true);
});

test('includes finalized events in finance', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'finalized',
    billingStatus: 'pending',
    assignments: [],
  }), true);
});

test('includes an event when all billable assignments are validated', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    assignments: [
      { status: 'confirmed', validationStatus: 'validated' },
      { status: 'confirmed', validationStatus: 'validated' },
    ],
  }), true);
});

test('does not include an event while billable assignments are still pending validation', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    assignments: [
      { status: 'confirmed', validationStatus: 'validated' },
      { status: 'confirmed', validationStatus: 'pending' },
    ],
  }), false);
});

test('ignores cancelled and missed assignments when checking validation readiness', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    assignments: [
      { status: 'confirmed', validationStatus: 'validated' },
      { status: 'cancelled', validationStatus: 'pending' },
      { status: 'missed_justified', validationStatus: 'pending' },
    ],
  }), true);
});

test('keeps events with closed billing statuses visible', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'invoiced',
    assignments: [],
  }), true);
});
