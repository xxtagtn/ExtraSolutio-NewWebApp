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

test('sums every day and split shift using the single historical event rate', () => {
  const totals = calculateEventTotals({
    startTime: '11:30',
    endTime: '16:00',
    requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 9.5 }],
  }, [
    { role: 'Emp.Mesa', assignmentDate: '2026-06-22', plannedCheckIn: '11:30', plannedCheckOut: '16:00', status: 'confirmed', hourlyRate: 8 },
    { role: 'Sem função', assignmentDate: '2026-06-23', checkIn: '11:32', checkOut: '15:51', status: 'confirmed', hourlyRate: 8 },
    { role: 'Sem função', assignmentDate: '2026-06-27', clientCheckIn: '11:30', clientCheckOut: '16:10', status: 'confirmed', hourlyRate: 8 },
    { role: 'Sem função', assignmentDate: '2026-06-27', clientCheckIn: '19:00', clientCheckOut: '23:04', status: 'confirmed', hourlyRate: 8 },
  ]);

  assert.equal(totals.totalRevenue, 166.25);
  assert.equal(totals.billableHours, 17.5);
  assert.equal(totals.totalCost, 72);
});

test('includes collaborator VAT and payment adjustments in Staff cost', () => {
  const totals = calculateEventTotals({
    requiredRoles: [{ role: 'Barman', agreedRate: 12 }],
  }, [{
    role: 'Barman',
    plannedCheckIn: '10:00',
    plannedCheckOut: '15:00',
    hourlyRate: 8,
    paymentAdjustment: 2,
    collaborator: { includeVat: true },
  }]);

  assert.equal(totals.totalCost, 51.2);
});
