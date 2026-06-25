import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarDateKey,
  calendarDateWithMonth,
  calendarWeekDates,
  serviceOccursOnDate,
} from './calendarDates.js';

test('returns the Monday-to-Sunday dates for the selected calendar week', () => {
  const dates = calendarWeekDates(new Date(2026, 5, 19));

  assert.deepEqual(dates.map(calendarDateKey), [
    '2026-06-15',
    '2026-06-16',
    '2026-06-17',
    '2026-06-18',
    '2026-06-19',
    '2026-06-20',
    '2026-06-21',
  ]);
});

test('clamps the selected day when changing to a shorter month', () => {
  assert.equal(
    calendarDateKey(calendarDateWithMonth(new Date(2026, 0, 31), 2026, 1)),
    '2026-02-28',
  );
});

test('detects every day of a continuous event', () => {
  const service = {
    date: '2026-06-18',
    endDate: '2026-06-20',
    isContinuous: true,
  };

  assert.equal(serviceOccursOnDate(service, new Date(2026, 5, 17)), false);
  assert.equal(serviceOccursOnDate(service, new Date(2026, 5, 18)), true);
  assert.equal(serviceOccursOnDate(service, new Date(2026, 5, 19)), true);
  assert.equal(serviceOccursOnDate(service, new Date(2026, 5, 20)), true);
  assert.equal(serviceOccursOnDate(service, new Date(2026, 5, 21)), false);
});
