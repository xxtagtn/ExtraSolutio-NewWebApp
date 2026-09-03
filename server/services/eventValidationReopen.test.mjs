import assert from 'node:assert/strict';
import test from 'node:test';
import { reopenEventValidation, EVENT_VALIDATED_HOURS_MARKER } from './eventWorkflow.js';

function fixture({ failEventUpdate = false } = {}) {
  let stored = {
    id: 42,
    date: '2026-08-01',
    endDate: '2026-08-31',
    isContinuous: true,
    status: 'finalized',
    statusMode: 'manual',
    billingStatus: 'paid',
    notes: `Keep these notes\n${EVENT_VALIDATED_HOURS_MARKER} 2026-09-01`,
    invoices: [],
    assignments: Array.from({ length: 124 }, (_, index) => ({
      id: index + 1,
      eventId: 42,
      collaboratorId: (index % 4) + 1,
      assignmentDate: `2026-08-${String(Math.floor(index / 4) + 1).padStart(2, '0')}`,
      role: 'Emp.Mesa',
      status: 'confirmed',
      validationStatus: 'validated',
      plannedCheckIn: '11:00',
      plannedCheckOut: '16:00',
      checkIn: index === 123 ? null : '11:01',
      checkOut: index === 123 ? null : '14:56',
      clientCheckIn: index === 123 ? null : '11:01',
      clientCheckOut: index === 123 ? null : '14:55',
      validatedCheckIn: index === 123 ? null : '11:01',
      validatedCheckOut: index === 123 ? null : '14:55',
      paymentStatus: index === 123 ? 'unpaid' : 'paid',
      paymentDate: index === 123 ? null : '2026-09-01',
      paymentNotes: 'Keep payment notes',
      validationNotes: 'Keep validation notes',
      totalPay: 40,
      hourlyRate: 10,
    })),
  };
  const calls = { transactions: 0, assignmentUpdates: [], eventUpdates: [] };
  const prisma = {
    $transaction: async (callback) => {
      calls.transactions += 1;
      const pending = structuredClone(stored);
      const result = await callback({
        event: {
          findUnique: async ({ where }) => where.id === pending.id ? structuredClone(pending) : null,
          update: async ({ data }) => {
            calls.eventUpdates.push(data);
            if (failEventUpdate) throw new Error('event update failed');
            Object.assign(pending, data);
            return structuredClone(pending);
          },
        },
        eventAssignment: {
          updateMany: async ({ where, data }) => {
            calls.assignmentUpdates.push({ where, data });
            const selected = pending.assignments.filter((row) => where.id.in.includes(row.id));
            selected.forEach((row) => Object.assign(row, data));
            return { count: selected.length };
          },
        },
      });
      stored = pending;
      return result;
    },
  };
  return { prisma, calls, stored: () => stored };
}

test('reopens a month of assignments in one transaction without rewriting real hours or payments', async () => {
  const db = fixture();
  const original = structuredClone(db.stored());
  const assignmentIds = original.assignments.map((row) => row.id);
  const result = await reopenEventValidation(db.prisma, original.id, undefined, { assignmentIds });

  assert.equal(db.calls.transactions, 1);
  assert.equal(db.calls.assignmentUpdates.length, 1);
  assert.equal(db.calls.eventUpdates.length, 1);
  assert.equal(db.calls.assignmentUpdates[0].where.eventId, original.id);
  assert.deepEqual(db.calls.assignmentUpdates[0].where.id.in, assignmentIds);
  assert.equal(result.status, 'to_validate_staff');
  assert.equal(result.statusMode, 'automatic');
  assert.equal(result.billingStatus, original.billingStatus);
  assert.equal(result.notes, 'Keep these notes');
  for (const row of original.assignments) {
    assert.deepEqual(result.assignments.find((item) => item.id === row.id), {
      ...row,
      validatedCheckIn: null,
      validatedCheckOut: null,
      validationStatus: 'reopened',
    });
  }
});

test('reopening the missing schedule on day 31 leaves other days and collaborators unchanged', async () => {
  const db = fixture();
  const original = structuredClone(db.stored());
  const result = await reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] });
  assert.deepEqual(result.assignments.slice(0, 123), original.assignments.slice(0, 123));
  assert.equal(result.assignments[123].validationStatus, 'reopened');
  assert.equal(result.assignments[123].checkIn, null);
  assert.equal(result.assignments[123].checkOut, null);
  assert.equal(result.assignments[123].assignmentDate, '2026-08-31');
});

test('an event update failure rolls back the assignment revalidation as well', async () => {
  const db = fixture({ failEventUpdate: true });
  const original = structuredClone(db.stored());
  await assert.rejects(
    reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] }),
    /event update failed/,
  );
  assert.equal(db.calls.assignmentUpdates.length, 1);
  assert.deepEqual(db.stored(), original);
});

test('rejects assignments from another event before writing', async () => {
  const db = fixture();
  const original = structuredClone(db.stored());
  await assert.rejects(
    reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124, 999] }),
    (error) => error.statusCode === 404 && error.expose,
  );
  assert.equal(db.calls.assignmentUpdates.length, 0);
  assert.equal(db.calls.eventUpdates.length, 0);
  assert.deepEqual(db.stored(), original);
});

test('rejects invalid assignment selection without starting a transaction', async () => {
  for (const assignmentIds of ['all', [0], [1.5], [1, 1], [null]]) {
    const db = fixture();
    await assert.rejects(
      reopenEventValidation(db.prisma, 42, undefined, { assignmentIds }),
      (error) => error.statusCode === 400 && error.expose,
    );
    assert.equal(db.calls.transactions, 0);
  }
});

test('does not reopen a cancelled day or a non-working assignment', async () => {
  for (const status of ['cancelled', 'missed_justified', 'missed_unjustified']) {
    const db = fixture();
    db.stored().assignments[123].status = status;
    await assert.rejects(
      reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] }),
      (error) => error.statusCode === 409 && error.expose,
    );
    assert.equal(db.calls.assignmentUpdates.length, 0);
  }
  const db = fixture();
  db.stored().cancelledDays = JSON.stringify([{ date: '2026-08-31' }]);
  await assert.rejects(
    reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] }),
    (error) => error.statusCode === 409 && error.expose,
  );
});

test('legacy event-only reopen callers do not reset assignment validations', async () => {
  const db = fixture();
  const original = structuredClone(db.stored());
  const result = await reopenEventValidation(db.prisma, 42);
  assert.deepEqual(result.assignments, original.assignments);
  assert.equal(db.calls.assignmentUpdates.length, 0);
  assert.equal(result.status, 'to_validate_staff');
});

test('reopening the same selection twice is safe and does not erase notes or times', async () => {
  const db = fixture();
  const first = await reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] });
  const second = await reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [124] });
  assert.equal(second.assignments[123].validationStatus, 'reopened');
  assert.deepEqual(second, first);
});

test('single-day events can also reopen a selected assignment', async () => {
  const db = fixture();
  db.stored().isContinuous = false;
  db.stored().endDate = null;
  db.stored().assignments = [db.stored().assignments[0]];
  const result = await reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [1] });
  assert.equal(result.assignments[0].validationStatus, 'reopened');
  assert.equal(result.assignments[0].checkIn, '11:01');
  assert.equal(result.assignments[0].paymentStatus, 'paid');
});

test('an empty selection reopens only the event and an unknown event is not written', async () => {
  const db = fixture();
  const before = structuredClone(db.stored());
  const result = await reopenEventValidation(db.prisma, 42, undefined, { assignmentIds: [] });
  assert.deepEqual(result.assignments, before.assignments);
  assert.equal(db.calls.assignmentUpdates.length, 0);
  const unknown = await reopenEventValidation(db.prisma, 999, undefined, { assignmentIds: [124] });
  assert.equal(unknown, null);
  assert.equal(db.calls.eventUpdates.length, 1);
});
