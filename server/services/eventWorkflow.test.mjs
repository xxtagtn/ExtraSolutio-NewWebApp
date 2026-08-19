import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cancelEventDay,
  deriveEventWorkflowStatus,
  EVENT_WORKFLOW_MODE,
  isEventWorkflowManual,
  reactivateEventDay,
} from './eventWorkflow.js';

test('keeps a manually selected operational status unchanged', () => {
  const event = {
    status: 'team_complete',
    statusMode: EVENT_WORKFLOW_MODE.manual,
    date: '2026-06-10',
    assignments: [],
  };

  assert.equal(isEventWorkflowManual(event), true);
  assert.equal(deriveEventWorkflowStatus(event, new Date('2026-06-11T09:00:00')), 'team_complete');
});

test('uses the automatic service lifecycle for events without a manual override', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'team_complete',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_staff');
});

test('moves to client validation only after staff validation is accepted', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'to_validate_staff',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      {
        status: 'confirmed',
        checkIn: '09:00',
        checkOut: '17:00',
        validationStatus: 'staff_accepted',
      },
    ],
  }), 'to_validate_client');
});

test('planned times alone do not advance the workflow', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'to_validate_staff',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      {
        status: 'confirmed',
        plannedCheckIn: '09:00',
        plannedCheckOut: '17:00',
      },
    ],
  }), 'to_validate_staff');
});

test('uses the last active day when a continuous event ends with cancelled days', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'in_progress',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    endDate: '2026-06-12',
    isContinuous: true,
    cancelledDays: JSON.stringify([{ date: '2026-06-12' }]),
    requiredRoles: [
      { workDate: '2026-06-11', quantity: 1 },
    ],
    assignments: [
      {
        workDate: '2026-06-11',
        status: 'confirmed',
      },
    ],
  }, new Date('2026-06-12T09:00:00')), 'to_validate_staff');
});

test('cancels a represented day that is not fully validated even if the event status is finalized', async () => {
  const event = {
    id: 77,
    name: 'Evento contínuo legado',
    date: new Date('2026-06-29T00:00:00.000Z'),
    endDate: new Date('2026-06-30T00:00:00.000Z'),
    isContinuous: true,
    status: 'finalized',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    cancelledDays: null,
    requiredRoles: '[]',
    invoices: [],
    assignments: [
      {
        id: 501,
        assignmentDate: new Date('2026-07-05T00:00:00.000Z'),
        status: 'confirmed',
        validationStatus: 'staff_accepted',
        paymentStatus: 'unpaid',
        paymentDate: null,
      },
    ],
  };
  let updatedEventData = null;
  let cancelledAssignmentIds = [];
  const client = {
    event: {
      findUnique: async () => event,
      update: async ({ data }) => {
        updatedEventData = data;
        return event;
      },
    },
    eventAssignment: {
      updateMany: async ({ where }) => {
        cancelledAssignmentIds = where.id.in;
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(client),
  };

  await cancelEventDay(prisma, event.id, '2026-07-05');

  assert.deepEqual(cancelledAssignmentIds, [501]);
  assert.equal(
    JSON.parse(updatedEventData.cancelledDays)[0].date,
    '2026-07-05',
  );
});

test('reactivating one cancelled day leaves every other cancelled day unchanged', async () => {
  const event = {
    id: 88,
    date: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-08-30T00:00:00.000Z'),
    isContinuous: true,
    status: 'to_validate_staff',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    requiredRoles: '[]',
    invoices: [],
    cancelledDays: JSON.stringify([
      {
        date: '2026-08-21',
        assignmentStates: [{ id: 601, status: 'confirmed', validationStatus: 'pending' }],
      },
      {
        date: '2026-08-25',
        assignmentStates: [{ id: 602, status: 'confirmed', validationStatus: 'pending' }],
      },
    ]),
    assignments: [
      {
        id: 601,
        assignmentDate: new Date('2026-08-21T00:00:00.000Z'),
        status: 'cancelled',
        validationStatus: 'pending',
        paymentStatus: 'unpaid',
      },
      {
        id: 602,
        assignmentDate: new Date('2026-08-25T00:00:00.000Z'),
        status: 'cancelled',
        validationStatus: 'pending',
        paymentStatus: 'unpaid',
      },
    ],
  };
  const assignmentUpdates = [];
  let updatedEventData = null;
  const client = {
    event: {
      findUnique: async () => event,
      update: async ({ data }) => {
        updatedEventData = data;
        return event;
      },
    },
    eventAssignment: {
      update: async (request) => {
        assignmentUpdates.push(request);
        return event.assignments.find((assignment) => assignment.id === request.where.id);
      },
    },
  };
  const prisma = { $transaction: async (callback) => callback(client) };

  await reactivateEventDay(prisma, event.id, '2026-08-21');

  assert.deepEqual(assignmentUpdates.map((request) => request.where.id), [601]);
  assert.deepEqual(
    JSON.parse(updatedEventData.cancelledDays).map((entry) => entry.date),
    ['2026-08-25'],
  );
});
