import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isArchivedService,
  nextAutomaticServiceStatus,
  operationalStatusOptions,
  statusLabel,
} from './serviceStatus.js';

test('uses only operational service statuses and includes Finalizado', () => {
  const values = operationalStatusOptions.map((option) => option.value);

  assert.ok(values.includes('finalized'));
  assert.equal(values.includes('completed'), false);
  assert.equal(values.includes('paid'), false);
  assert.equal(values.includes('invoiced'), false);
});

test('moves service to in progress on the service date', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'team_complete',
    date: '2026-06-11',
    startTime: '18:00',
    endTime: '23:00',
    assignments: [],
  }, new Date('2026-06-11T09:00:00')), 'in_progress');
});

test('moves service to staff hour validation on the day after the service', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'in_progress',
    date: '2026-06-10',
    endTime: '23:00',
    assignments: [],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_staff');
});

test('moves service to client hour validation when all billable staff times are filled', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00' },
      { status: 'missed_justified' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_client');
});

test('does not move a future service to client validation just because planned staff times exist', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'team_complete',
    date: '2026-06-20',
    requiredRoles: [{ role: 'Barman', qty: 1 }],
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'team_complete');
});

test('keeps finalized services archived and maps retired final statuses to Finalizado', () => {
  assert.equal(nextAutomaticServiceStatus({ status: 'finalized', date: '2026-06-10' }), 'finalized');
  assert.equal(nextAutomaticServiceStatus({ status: 'paid', date: '2026-06-10' }), 'finalized');
  assert.equal(isArchivedService({ status: 'finalized' }), true);
  assert.equal(statusLabel('invoiced'), 'Finalizado');
});
