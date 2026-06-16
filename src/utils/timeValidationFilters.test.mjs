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

test('sorts validation rows chronologically by assignment date and time', () => {
  const rows = [
    { id: 3, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-02', plannedCheckIn: '08:00', collaborator: { shortName: 'Ana' } } },
    { id: 1, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '10:00', collaborator: { shortName: 'Rui' } } },
    { id: 2, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '08:00', collaborator: { shortName: 'Marta' } } },
  ];

  assert.deepEqual([...rows].sort(compareTimeValidationRows).map((row) => row.id), [2, 1, 3]);
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
