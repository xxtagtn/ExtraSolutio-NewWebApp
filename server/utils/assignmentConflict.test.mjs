import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertNoAssignmentConflict,
  assignmentConflictNeedsCheck,
} from './assignmentConflict.js';

function fakePrisma(existingAssignments) {
  return {
    event: {
      findUnique: async () => ({
        id: 20,
        date: new Date('2026-06-17T00:00:00.000Z'),
        startTime: '11:30',
        endTime: '23:00',
      }),
    },
    eventAssignment: {
      findMany: async () => existingAssignments,
    },
  };
}

test('server allows a second non-overlapping shift on the same day', async () => {
  const prisma = fakePrisma([{
    id: 1,
    collaboratorId: 7,
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
    assignmentDate: new Date('2026-06-17T00:00:00.000Z'),
    event: { id: 10, date: new Date('2026-06-17T00:00:00.000Z') },
  }]);

  await assert.doesNotReject(() => assertNoAssignmentConflict(prisma, {
    eventId: 20,
    collaboratorId: 7,
    assignmentDate: new Date('2026-06-17T00:00:00.000Z'),
    plannedCheckIn: '19:00',
    plannedCheckOut: '23:00',
  }));
});

test('server rejects an overlapping shift from another event', async () => {
  const prisma = fakePrisma([{
    id: 1,
    collaboratorId: 7,
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
    assignmentDate: new Date('2026-06-17T00:00:00.000Z'),
    event: { id: 10, date: new Date('2026-06-17T00:00:00.000Z') },
  }]);

  await assert.rejects(
    () => assertNoAssignmentConflict(prisma, {
      eventId: 20,
      collaboratorId: 7,
      assignmentDate: new Date('2026-06-17T00:00:00.000Z'),
      plannedCheckIn: '12:00',
      plannedCheckOut: '18:00',
    }),
    (error) => error.statusCode === 409
      && error.message === 'Este colaborador já está alocado neste dia num horário que se sobrepõe.',
  );
});

test('server skips conflict revalidation when an existing schedule was not changed', () => {
  const existing = {
    eventId: 20,
    collaboratorId: 7,
    assignmentDate: new Date('2026-06-19T00:00:00.000Z'),
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
    checkIn: '11:32',
    checkOut: '15:58',
  };
  const data = {
    eventId: 20,
    collaboratorId: 7,
    assignmentDate: new Date('2026-06-19T00:00:00.000Z'),
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
    checkIn: '11:32',
    checkOut: '15:58',
    paymentStatus: 'paid',
  };

  assert.equal(assignmentConflictNeedsCheck(data, existing), false);
  assert.equal(assignmentConflictNeedsCheck({ ...data, plannedCheckIn: '19:00' }, existing), true);
});
