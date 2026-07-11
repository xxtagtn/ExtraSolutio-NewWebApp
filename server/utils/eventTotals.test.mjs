import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentHasRecordedHours, calculateEventTotals } from './eventTotals.js';

test('recalculates validated event revenue, staff cost and rounded hours centrally', () => {
  const totals = calculateEventTotals({
    requiredRoles: [{ role: 'Barman', agreedRate: 10.5 }],
    minimumHoursSnapshot: 5,
    travelExpenseEnabled: true,
    travelExpenseAmount: 20,
    externalCosts: [{ costAmount: 100, marginPercent: 20 }],
  }, [{
    role: 'Barman',
    status: 'confirmed',
    checkIn: '09:14',
    checkOut: '13:15',
    clientCheckIn: '09:14',
    clientCheckOut: '13:15',
    hourlyRate: 8,
    advancePayments: [{ amount: 10, car: true }],
  }]);

  assert.deepEqual(totals, {
    totalRevenue: 192.5,
    totalCost: 146,
    realHours: 4.5,
    billableHours: 5,
  });
});

test('preserves totals imported from a budget when rates cannot rebuild them', () => {
  const totals = calculateEventTotals({
    totalRevenue: 500,
    totalCost: 200,
    requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 0 }],
  }, [{
    role: 'Emp.Mesa',
    status: 'confirmed',
    checkIn: '10:00',
    checkOut: '14:00',
    hourlyRate: 0,
  }]);

  assert.equal(totals.totalRevenue, 500);
  assert.equal(totals.totalCost, 200);
});

test('excludes cancelled and absent collaborators from event totals', () => {
  const totals = calculateEventTotals({
    totalRevenue: 500,
    totalCost: 200,
    travelExpenseEnabled: true,
    travelExpenseAmount: 25,
    externalCosts: [{ costAmount: 50, marginPercent: 10 }],
  }, [{
    role: 'Emp.Mesa',
    status: 'cancelled',
    checkIn: '10:00',
    checkOut: '18:00',
    hourlyRate: 8,
  }]);

  assert.deepEqual(totals, {
    totalRevenue: 80,
    totalCost: 50,
    realHours: 0,
    billableHours: 0,
  });
});

test('distinguishes planned times from recorded Staff or Client hours', () => {
  assert.equal(assignmentHasRecordedHours({
    plannedCheckIn: '10:00',
    plannedCheckOut: '18:00',
  }), false);
  assert.equal(assignmentHasRecordedHours({
    plannedCheckIn: '10:00',
    plannedCheckOut: '18:00',
    checkIn: '10:05',
  }), true);
});
