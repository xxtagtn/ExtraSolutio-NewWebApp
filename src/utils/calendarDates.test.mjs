import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarDateKey,
  calendarInitialCursor,
  calendarDateWithMonth,
  calendarMonthCells,
  calendarWeekDates,
  calendarServiceDayKeys,
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

test('starts the calendar on the current day instead of the next event month', () => {
  assert.equal(
    calendarDateKey(calendarInitialCursor(new Date(2026, 5, 29, 18, 45))),
    '2026-06-29',
  );
});

test('detects every day of a continuous event', () => {
  const service = {
    date: '2026-06-18',
    endDate: '2026-06-20',
    isContinuous: true,
  };

  assert.deepEqual(calendarServiceDayKeys(service), ['2026-06-18', '2026-06-19', '2026-06-20']);
});

test('returns only active service days, even across months or years', () => {
  const service = { date: new Date('2026-12-30T00:00:00Z'), endDate: '2027-01-01', isContinuous: true,
    cancelledDays: '["2026-12-31",{"date":"2027-01-01"}]' };

  assert.deepEqual(calendarServiceDayKeys(service), ['2026-12-30']);
  assert.deepEqual(calendarServiceDayKeys({ ...service, status: ' Cancelled ' }), []);
  assert.deepEqual(calendarServiceDayKeys({ ...service, date: '2026-12-31' }), []);
  assert.deepEqual(calendarServiceDayKeys({ date: '2026-06-20', status: 'cancelled' }), []);
  assert.deepEqual(calendarServiceDayKeys({ date: '2026-06-20' }), ['2026-06-20']);
  assert.deepEqual(calendarServiceDayKeys({ date: '2026-02-30' }), []);
});

test('builds a six-row month grid with adjacent month days', () => {
  const cells = calendarMonthCells(new Date(2026, 6, 4));

  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-06-29');
  assert.equal(cells[41].key, '2026-08-09');
  assert.equal(cells.find((cell) => cell.key === '2026-07-01').isCurrentMonth, true);
  assert.equal(cells[0].isCurrentMonth, false);
});
