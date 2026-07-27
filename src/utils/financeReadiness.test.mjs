import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFinanceReadyEvent, splitFinanceReadiness } from './financeReadiness.js';

test('does not make an event processable only because it has a validated marker', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    notes: '[EVENT_VALIDATED_HOURS] 2026-06-03T12:00:00.000Z',
    assignments: [],
  }), false);
});

test('reconciles a stale operational status after explicit event validation', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'to_validate_client',
    notes: '[EVENT_VALIDATED_HOURS] 2026-06-03T12:00:00.000Z',
    assignments: [{
      collaboratorId: 7,
      status: 'confirmed',
      validationStatus: 'validated',
      clientCheckIn: '10:00',
      clientCheckOut: '16:00',
    }],
  }), true);
});

test('does not reconcile a marker when client validation is incomplete', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'to_validate_client',
    notes: '[EVENT_VALIDATED_HOURS] 2026-06-03T12:00:00.000Z',
    assignments: [{
      collaboratorId: 7,
      status: 'confirmed',
      validationStatus: 'validated',
      clientCheckIn: '10:00',
      clientCheckOut: null,
    }],
  }), false);
});

test('includes finalized events in finance', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'finalized',
    billingStatus: 'pending',
    assignments: [],
  }), true);
});

test('does not make an event processable only because all billable assignments are validated', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'pending',
    assignments: [
      { status: 'confirmed', validationStatus: 'validated' },
      { status: 'confirmed', validationStatus: 'validated' },
    ],
  }), false);
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

test('does not make an event processable while it is still operationally open', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'to_validate_client',
    billingStatus: 'pending',
    assignments: [
      { status: 'confirmed', validationStatus: 'validated' },
    ],
  }), false);
});

test('does not make an event processable only because billing is closed', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'invoiced',
    assignments: [],
  }), false);
});

test('includes an external-only event after its billing is processed', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'drafting',
    billingStatus: 'paid',
    assignments: [],
    externalCosts: JSON.stringify([
      { id: 'external-1', supplier: 'Fun Ride', costAmount: 790 },
    ]),
  }), true);

  assert.equal(isFinanceReadyEvent({
    status: 'drafting',
    billingStatus: 'invoiced',
    assignments: [],
    externalCosts: [
      { id: 'external-1', supplier: 'Fun Ride', costAmount: 790 },
    ],
  }), true);
});

test('keeps pending external-only events in forecast', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'drafting',
    billingStatus: 'pending',
    assignments: [],
    externalCosts: JSON.stringify([
      { id: 'external-1', supplier: 'Fun Ride', costAmount: 790 },
    ]),
  }), false);
});

test('does not bypass operational validation when staff exists', () => {
  assert.equal(isFinanceReadyEvent({
    status: 'team_complete',
    billingStatus: 'paid',
    assignments: [{ collaboratorId: 7, validationStatus: 'pending' }],
    externalCosts: JSON.stringify([
      { id: 'external-1', supplier: 'Fun Ride', costAmount: 790 },
    ]),
  }), false);
});

test('keeps legacy final operational statuses processable', () => {
  assert.equal(isFinanceReadyEvent({ status: 'paid', billingStatus: 'pending' }), true);
  assert.equal(isFinanceReadyEvent({ status: 'invoiced', billingStatus: 'pending' }), true);
  assert.equal(isFinanceReadyEvent({ status: 'completed', billingStatus: 'pending' }), true);
});

test('splits events between forecast and processable finance buckets', () => {
  const result = splitFinanceReadiness([
    { id: 1, status: 'finalized' },
    { id: 2, status: 'to_validate_client', billingStatus: 'paid' },
    { id: 3, status: 'drafting' },
    {
      id: 4,
      status: 'drafting',
      billingStatus: 'paid',
      externalCosts: '[{"id":"external-1"}]',
      assignments: [],
    },
  ]);

  assert.deepEqual(result.readyEvents.map((event) => event.id), [1, 4]);
  assert.deepEqual(result.forecastEvents.map((event) => event.id), [2, 3]);
});
