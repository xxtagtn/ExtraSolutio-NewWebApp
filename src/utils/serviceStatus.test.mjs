import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAFF_ACCEPTED_VALIDATION_STATUS } from './hourValidationStatus.js';
import {
  isArchivedService,
  deriveServiceWorkflowStatus,
  nextAutomaticServiceStatus,
  nextTimeValidationServiceStatus,
  operationalStatusOptions,
  serviceStatusForDisplay,
  servicesNeedingWorkflowSync,
  statusLabel,
} from './serviceStatus.js';

test('9 current active services and 54 archived services need no synchronization requests', () => {
  const now = new Date('2026-11-19T12:00:00');
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: i + 1, status: 'drafting',
      statusMode: 'automatic', date: '2027-02-01', assignments: [] })),
    ...Array.from({ length: 54 }, (_, i) => ({ id: i + 10, status: 'finalized',
      statusMode: 'automatic', date: '2026-10-01', assignments: [] })),
  ];
  assert.deepEqual(servicesNeedingWorkflowSync(rows, now), []);
  assert.equal(rows.length, 63);
});

test('sync candidates retain validation transitions and skip manual and unchanged statuses', () => {
  const now = new Date('2026-11-19T12:00:00');
  const rows = [
    { id: 1, status: 'drafting', date: '2026-11-19', assignments: [] },
    { id: 2, status: 'in_progress', date: '2026-11-19', assignments: [] },
    { id: 3, status: 'drafting', statusMode: 'manual', date: '2026-11-19', assignments: [] },
    { id: 4, status: 'cancelled', date: '2026-11-18', assignments: [] },
    { id: 5, status: 'to_validate_staff', date: '2026-11-18', assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00', validationStatus: 'validated' },
    ] },
    { id: 6, status: 'to_validate_client', date: '2026-11-18', assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00', validationStatus: 'validated' },
    ] },
    { id: 7, status: 'paid', date: '2026-10-01', assignments: [] },
  ];
  assert.deepEqual(servicesNeedingWorkflowSync(rows, now).map((row) => row.id), [1, 5, 7]);
  assert.equal(deriveServiceWorkflowStatus(rows[0], now), 'in_progress');
  assert.equal(deriveServiceWorkflowStatus(rows[4], now), 'to_validate_client');
  assert.equal(deriveServiceWorkflowStatus(rows[6], now), 'finalized');
});

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

test('keeps a past service in drafting while no staff is selected', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'drafting',
    date: '2026-06-10',
    requiredRoles: [{ role: 'Barman', qty: 2 }],
    assignments: [],
  }, new Date('2026-06-11T09:00:00')), 'drafting');
});

test('corrects a wrongly synced staff validation service with no selected staff', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    requiredRoles: [{ role: 'Barman', qty: 2 }],
    assignments: [],
  }, new Date('2026-06-11T09:00:00')), 'drafting');
});

test('keeps a past service in drafting until the requested staff is confirmed', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'drafting',
    date: '2026-06-10',
    requiredRoles: [{ role: 'Barman', qty: 2 }],
    assignments: [
      { status: 'confirmed' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'drafting');
});

test('moves a past service with complete confirmed staff to staff hour validation', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'team_complete',
    date: '2026-06-10',
    requiredRoles: [{ role: 'Barman', qty: 2 }],
    assignments: [
      { status: 'confirmed' },
      { status: 'confirmed' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_staff');
});

test('does not move service to client hour validation during automatic status sync', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { collaboratorId: 1, status: 'confirmed', checkIn: '09:00', checkOut: '17:00' },
      { collaboratorId: 2, status: 'missed_justified' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_staff');
});

test('time validation keeps service in staff validation when staff times are only saved', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00', validationStatus: 'pending' },
      { status: 'missed_justified' },
    ],
  }), 'to_validate_staff');
});

test('continuous service requires every scheduled slot to be confirmed', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'team_complete',
    isContinuous: true,
    date: '2026-06-10',
    endDate: '2026-06-12',
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }],
    assignments: [
      { role: 'Emp.Mesa', collaboratorId: 1, assignmentDate: '2026-06-10', status: 'confirmed' },
      { role: 'Emp.Mesa', collaboratorId: 2, assignmentDate: '2026-06-11', status: 'pending_confirmation' },
    ],
  }, new Date('2026-06-09T09:00:00')), 'drafting');
});

test('continuous service is complete when all scheduled slots are confirmed', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'drafting',
    isContinuous: true,
    date: '2026-06-10',
    endDate: '2026-06-12',
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }],
    assignments: [
      { role: 'Emp.Mesa', collaboratorId: 1, assignmentDate: '2026-06-10', status: 'confirmed' },
      { role: 'Emp.Mesa', collaboratorId: 2, assignmentDate: '2026-06-11', status: 'confirmed' },
    ],
  }, new Date('2026-06-09T09:00:00')), 'team_complete');
});

test('time validation moves service to client hour validation when staff column is accepted', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00', validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS },
      { status: 'missed_justified' },
    ],
  }), 'to_validate_client');
});

test('time validation keeps service in staff validation until staff column is complete', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00' },
      { status: 'confirmed', checkIn: '09:00', checkOut: '' },
    ],
  }), 'to_validate_staff');
});

test('time validation ignores planned collaborator times as manual staff times', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_staff',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', plannedCheckIn: '09:00', plannedCheckOut: '17:00' },
    ],
  }), 'to_validate_staff');
});

test('time validation keeps service awaiting explicit event validation when client column is complete', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_client',
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed', checkIn: '09:00', checkOut: '17:00', clientCheckIn: '09:10', clientCheckOut: '17:15' },
      { status: 'missed_justified' },
    ],
  }), 'to_validate_client');
});

test('adding an unfilled collaborator moves Client validation back to Staff validation', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_client',
    assignments: [
      {
        status: 'confirmed',
        checkIn: '09:00',
        checkOut: '17:00',
        validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
      },
      {
        status: 'confirmed',
        checkIn: null,
        checkOut: null,
        validationStatus: 'pending',
      },
    ],
  }), 'to_validate_staff');
});

test('reopening one collaborator moves Client validation back to Staff validation', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_client',
    assignments: [
      {
        status: 'confirmed',
        checkIn: '09:00',
        checkOut: '17:00',
        validationStatus: 'reopened',
      },
    ],
  }), 'to_validate_staff');
});

test('copying client hours does not accept the staff validation automatically', () => {
  assert.equal(nextTimeValidationServiceStatus({
    status: 'to_validate_staff',
    assignments: [
      {
        status: 'confirmed',
        checkIn: '09:00',
        checkOut: '17:00',
        clientCheckIn: '09:00',
        clientCheckOut: '17:00',
        validationStatus: 'pending',
      },
    ],
  }), 'to_validate_staff');
});

test('does not move a future service to client validation just because planned staff times exist', () => {
  assert.equal(nextAutomaticServiceStatus({
    status: 'team_complete',
    date: '2026-06-20',
    requiredRoles: [{ role: 'Barman', qty: 1 }],
    assignments: [
      { collaboratorId: 1, status: 'confirmed', checkIn: '09:00', checkOut: '17:00' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'team_complete');
});

test('keeps finalized services archived and maps retired final statuses to Finalizado', () => {
  assert.equal(nextAutomaticServiceStatus({ status: 'finalized', date: '2026-06-10' }), 'finalized');
  assert.equal(nextAutomaticServiceStatus({ status: 'paid', date: '2026-06-10' }), 'finalized');
  assert.equal(isArchivedService({ status: 'finalized' }), true);
  assert.equal(statusLabel('invoiced'), 'Finalizado');
});

test('uses the persisted manual status when rendering an event', () => {
  assert.equal(serviceStatusForDisplay({
    status: 'team_complete',
    statusMode: 'manual',
    date: '2026-06-10',
  }, new Date('2026-06-11T09:00:00')), 'team_complete');
});
