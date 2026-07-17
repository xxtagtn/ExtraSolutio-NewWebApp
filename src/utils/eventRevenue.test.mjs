import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventRevenueForDisplay, resolveEventRevenue } from './eventRevenue.js';

test('uses the persisted API total in event lists instead of recalculating stale assignment rows', () => {
  assert.equal(eventRevenueForDisplay({
    totalRevenue: '731.50',
    assignments: [{ role: 'Sem função', hoursWorked: 4.5 }],
  }), 731.5);
});

test('keeps calculated event revenue when current event data can calculate it', () => {
  assert.equal(resolveEventRevenue({
    calculatedTotalRevenue: 420,
    calculatedExpectedRevenue: 400,
    storedTotalRevenue: 1000,
  }), 420);
});

test('falls back to the stored budget revenue when event calculation has no usable value', () => {
  assert.equal(resolveEventRevenue({
    calculatedTotalRevenue: 0,
    calculatedExpectedRevenue: 0,
    storedTotalRevenue: '284,50 EUR',
  }), 284.5);
});

test('uses expected revenue before stored value when there are no assignments yet', () => {
  assert.equal(resolveEventRevenue({
    calculatedTotalRevenue: 0,
    calculatedExpectedRevenue: 390,
    storedTotalRevenue: 284.5,
  }), 390);
});
