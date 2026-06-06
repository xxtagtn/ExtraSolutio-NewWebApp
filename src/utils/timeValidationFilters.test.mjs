import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterRowsByDateRange, filterRowsBySelectedDays, localDayNumber } from './timeValidationFilters.js';

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
