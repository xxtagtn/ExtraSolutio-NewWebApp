import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareTimeValidationRows,
  dateKeysFrom,
  effectiveRowDateKey,
  effectiveRowStartTime,
  filterRowsByDateRange,
  filterRowsBySelectedDays,
  localDayNumber,
  normalizeTimeInput,
  sanitizeTimeInput,
} from './timeValidationFilters.js';

test('gets the local day number from an event date', () => {
  assert.equal(localDayNumber('2026-07-08T00:00:00.000Z'), 8);
});

test('filters validation rows by one or more selected days', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' } },
  ];

  assert.deepEqual(filterRowsBySelectedDays(rows, [3, 12]).map((row) => row.id), [1, 3]);
});

test('uses assignment date instead of event date for validation row dates', () => {
  const row = {
    event: { date: '2026-07-01' },
    assignment: { assignmentDate: '2026-07-04T00:00:00.000Z' },
  };

  assert.equal(effectiveRowDateKey(row), '2026-07-04');
});

test('uses planned assignment start as effective row start time', () => {
  const row = {
    event: { startTime: '09:00' },
    assignment: { plannedCheckIn: '14:00', checkIn: '15:00' },
  };

  assert.equal(effectiveRowStartTime(row), '14:00');
});

test('sorts validation rows by date and collaborator name', () => {
  const rows = [
    { id: 3, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-02', plannedCheckIn: '08:00', collaborator: { shortName: 'Ana' } } },
    { id: 1, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '10:00', collaborator: { shortName: 'Rui' } } },
    { id: 2, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '08:00', collaborator: { shortName: 'Marta' } } },
  ];

  assert.deepEqual([...rows].sort(compareTimeValidationRows).map((row) => row.id), [2, 1, 3]);
});

test('keeps collaborator order stable while staff and client times are edited', () => {
  const rows = [
    {
      id: 1,
      collaboratorName: 'Rui',
      event: { name: 'Evento', date: '2026-07-01' },
      assignment: { collaborator: { shortName: 'Rui' } },
    },
    {
      id: 2,
      collaboratorName: 'Ana',
      event: { name: 'Evento', date: '2026-07-01' },
      assignment: { collaborator: { shortName: 'Ana' } },
    },
  ];

  const initialOrder = [...rows].sort(compareTimeValidationRows).map((row) => row.id);
  const editedRows = rows.map((row) => (
    row.id === 1
      ? { ...row, assignment: { ...row.assignment, checkIn: '08:00', checkOut: '17:00', clientCheckIn: '08:15' } }
      : row
  ));

  assert.deepEqual(initialOrder, [2, 1]);
  assert.deepEqual([...editedRows].sort(compareTimeValidationRows).map((row) => row.id), initialOrder);
});

test('normalizes date key collections from sets', () => {
  assert.deepEqual(dateKeysFrom(new Set(['2026-07-04', '', '2026-07-05'])), ['2026-07-04', '2026-07-05']);
});

test('filters selected days by assignment date when present', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' }, assignment: {} },
  ];

  assert.deepEqual(filterRowsBySelectedDays(rows, [3, 12]).map((row) => row.id), [1, 3]);
});

test('keeps all validation rows when no day is selected', () => {
  const rows = [{ id: 1, event: { date: '2026-07-03' } }];

  assert.deepEqual(filterRowsBySelectedDays(rows, []).map((row) => row.id), [1]);
});

test('filters validation rows inside a date range', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' } },
  ];

  assert.deepEqual(filterRowsByDateRange(rows, '2026-07-04', '2026-07-10').map((row) => row.id), [2]);
});

test('filters date range by assignment date when present', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' }, assignment: {} },
  ];

  assert.deepEqual(filterRowsByDateRange(rows, '2026-07-04', '2026-07-10').map((row) => row.id), [2]);
});

test('completes an hour-only validation time with zero minutes', () => {
  assert.equal(normalizeTimeInput('14'), '14:00');
  assert.equal(normalizeTimeInput('9'), '09:00');
});

test('normalizes compact and partial-minute validation times', () => {
  assert.equal(normalizeTimeInput('1430'), '14:30');
  assert.equal(normalizeTimeInput('14:3'), '14:30');
  assert.equal(normalizeTimeInput('09:05'), '09:05');
});

test('keeps invalid validation times visible for manual correction', () => {
  assert.equal(normalizeTimeInput('25'), '25');
  assert.equal(normalizeTimeInput('14:75'), '14:75');
});

test('sanitizes validation time drafts without blocking compact input', () => {
  assert.equal(sanitizeTimeInput('14h30'), '1430');
  assert.equal(sanitizeTimeInput('14:30 extra'), '14:30');
});
