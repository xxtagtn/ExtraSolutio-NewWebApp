import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSIGNMENT_OVERLAP_MESSAGE,
  assignmentScheduleChanged,
  findOverlappingAssignment,
} from './assignmentOverlap.js';

const eventA = {
  id: 10,
  date: '2026-06-17',
  startTime: '11:30',
  endTime: '23:00',
};

function entry(id, collaboratorId, start, end, event = eventA, assignmentDate = null) {
  return {
    assignment: {
      id,
      collaboratorId,
      assignmentDate,
      plannedCheckIn: start,
      plannedCheckOut: end,
    },
    event,
  };
}

test('allows split shifts for the same collaborator on the same day', () => {
  const candidate = entry(2, 7, '19:00', '23:00');
  const existing = [entry(1, 7, '11:30', '16:00')];

  assert.equal(findOverlappingAssignment(candidate, existing), null);
});

test('blocks a real overlap for the same collaborator on the same day', () => {
  const candidate = entry(2, 7, '12:00', '18:00');
  const existing = [entry(1, 7, '11:30', '16:00')];

  assert.equal(findOverlappingAssignment(candidate, existing)?.assignment.id, 1);
});

test('allows adjacent shifts where one starts when the other ends', () => {
  const candidate = entry(2, 7, '16:00', '19:00');
  const existing = [entry(1, 7, '11:30', '16:00')];

  assert.equal(findOverlappingAssignment(candidate, existing), null);
});

test('allows the same collaborator at the same time on different dates', () => {
  const candidate = entry(2, 7, '11:30', '16:00', eventA, '2026-06-18');
  const existing = [entry(1, 7, '11:30', '16:00', eventA, '2026-06-17')];

  assert.equal(findOverlappingAssignment(candidate, existing), null);
});

test('detects overlap between different events on the same date', () => {
  const eventB = { id: 11, date: '2026-06-17', startTime: '12:00', endTime: '18:00' };
  const candidate = entry(2, 7, '12:00', '18:00', eventB);
  const existing = [entry(1, 7, '11:30', '16:00', eventA)];

  assert.equal(findOverlappingAssignment(candidate, existing)?.event.id, 10);
});

test('does not compare schedules from different collaborators', () => {
  const candidate = entry(2, 8, '12:00', '18:00');
  const existing = [entry(1, 7, '11:30', '16:00')];

  assert.equal(findOverlappingAssignment(candidate, existing), null);
});

test('ignores the assignment being edited', () => {
  const candidate = entry(1, 7, '12:00', '18:00');
  const existing = [entry(1, 7, '11:30', '16:00')];

  assert.equal(findOverlappingAssignment(candidate, existing), null);
});

test('exports the required conflict message', () => {
  assert.equal(
    ASSIGNMENT_OVERLAP_MESSAGE,
    'Este colaborador já está alocado neste dia num horário que se sobrepõe.',
  );
});

test('detects whether the allocation schedule was actually changed', () => {
  const original = {
    collaboratorId: 7,
    assignmentDate: '2026-06-19T00:00:00.000Z',
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
    checkIn: '11:32',
    checkOut: '15:58',
  };

  assert.equal(assignmentScheduleChanged({
    ...original,
    collaboratorId: '7',
    assignmentDate: '2026-06-19',
  }, original), false);
  assert.equal(assignmentScheduleChanged({
    ...original,
    plannedCheckIn: '19:00',
    plannedCheckOut: '23:00',
  }, original), true);
});
