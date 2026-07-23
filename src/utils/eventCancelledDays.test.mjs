import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeEventAssignments,
  activeEventDayKeys,
  activeEventRequiredRoles,
  eventDayKey,
  eventDayKeys,
  isAssignmentOnCancelledDay,
  normalizeCancelledDayEntries,
  representedEventDayKeys,
} from './eventCancelledDays.js';

const continuousEvent = {
  date: '2026-06-29',
  endDate: '2026-07-02',
  isContinuous: true,
  cancelledDays: JSON.stringify([
    {
      date: '2026-06-30',
      assignmentStates: [
        { id: 12, status: 'confirmed', validationStatus: 'pending' },
      ],
    },
  ]),
  assignments: [
    { id: 11, workDate: '2026-06-29', status: 'confirmed' },
    { id: 12, workDate: '2026-06-30', status: 'cancelled' },
    { id: 13, workDate: '2026-07-01', status: 'confirmed' },
  ],
  requiredRoles: [
    { id: 21, workDate: '2026-06-29', role: 'Emp.Mesa' },
    { id: 22, workDate: '2026-06-30', role: 'Barman' },
    { id: 23, workDate: '2026-07-01', role: 'Emp.Mesa' },
  ],
};

test('normalizes and orders cancelled days stored as JSON', () => {
  assert.deepEqual(
    normalizeCancelledDayEntries(continuousEvent).map((entry) => entry.date),
    ['2026-06-30'],
  );
});

test('normalizes Prisma Date values without losing the event day', () => {
  assert.equal(eventDayKey(new Date('2026-07-05T00:00:00.000Z')), '2026-07-05');
  assert.deepEqual(eventDayKeys({
    date: new Date('2026-06-29T00:00:00.000Z'),
    endDate: new Date('2026-07-05T00:00:00.000Z'),
    isContinuous: true,
  }), [
    '2026-06-29',
    '2026-06-30',
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
    '2026-07-05',
  ]);
});

test('recognizes assignment days represented in a legacy continuous event', () => {
  assert.deepEqual(representedEventDayKeys({
    date: new Date('2026-06-29T00:00:00.000Z'),
    endDate: new Date('2026-06-30T00:00:00.000Z'),
    isContinuous: true,
    assignments: [
      { assignmentDate: new Date('2026-07-04T00:00:00.000Z') },
      { assignmentDate: new Date('2026-07-05T00:00:00.000Z') },
    ],
  }), [
    '2026-06-29',
    '2026-06-30',
    '2026-07-04',
    '2026-07-05',
  ]);
});

test('removes cancelled days from operational day ranges', () => {
  assert.deepEqual(activeEventDayKeys(continuousEvent), [
    '2026-06-29',
    '2026-07-01',
    '2026-07-02',
  ]);
});

test('excludes assignments and required roles belonging to cancelled days', () => {
  assert.equal(isAssignmentOnCancelledDay(continuousEvent.assignments[1], continuousEvent), true);
  assert.deepEqual(activeEventAssignments(continuousEvent).map((row) => row.id), [11, 13]);
  assert.deepEqual(activeEventRequiredRoles(continuousEvent).map((row) => row.id), [21, 23]);
});
