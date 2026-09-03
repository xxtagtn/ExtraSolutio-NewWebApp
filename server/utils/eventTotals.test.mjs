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
    totalRevenue: 220.1,
    totalCost: 146,
    taxAmount: 27.6,
    realHours: 4.5,
    billableHours: 5,
  });
});

test('uses independently rounded client and staff clocks across midnight', () => {
  const totals = calculateEventTotals({
    requiredRoles: [{ role: 'Barman', agreedRate: 10 }],
  }, [{
    role: 'Barman',
    status: 'confirmed',
    checkIn: '19:08',
    checkOut: '00:46',
    clientCheckIn: '19:08',
    clientCheckOut: '00:46',
    hourlyRate: 8,
  }]);

  assert.deepEqual(totals, {
    totalRevenue: 60,
    totalCost: 48,
    taxAmount: 0,
    realHours: 6,
    billableHours: 6,
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
    totalRevenue: 92.65,
    totalCost: 50,
    taxAmount: 12.65,
    realHours: 0,
    billableHours: 0,
  });
});

test('keeps VAT outside operational cost while preserving gross revenue', () => {
  const totals = calculateEventTotals({
    totalRevenue: 1166.04,
    totalCost: 790,
    taxAmount: 218.04,
    externalCosts: [{
      type: 'Catering',
      costAmount: 790,
      marginPercent: 20,
      vatType: 'standard_23',
    }],
  }, []);

  assert.deepEqual(totals, {
    totalRevenue: 1166.04,
    totalCost: 790,
    taxAmount: 218.04,
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

test('recalculates 140 to 70 when the active team changes from two people to one', () => {
  const event = {
    status: 'to_validate_staff',
    startTime: '12:00',
    endTime: '16:00',
    minimumHoursSnapshot: 5,
    totalRevenue: 140,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }],
  };
  const assignment = {
    role: 'Emp.Mesa',
    status: 'confirmed',
    plannedCheckIn: '12:00',
    plannedCheckOut: '16:00',
    hourlyRate: 8.5,
  };

  assert.equal(calculateEventTotals(event, [assignment]).totalRevenue, 70);
  assert.equal(calculateEventTotals({
    ...event,
    status: 'drafting',
    requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 14 }],
  }, [assignment]).totalRevenue, 140);
});

test('applies minimum hours independently to each active collaborator', () => {
  const event = {
    status: 'to_validate_staff',
    minimumHoursSnapshot: 5,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }],
  };

  assert.equal(calculateEventTotals(event, [{
    role: 'Emp.Mesa', status: 'confirmed', plannedCheckIn: '12:00', plannedCheckOut: '15:00', hourlyRate: 8,
  }]).totalRevenue, 70);
  assert.equal(calculateEventTotals(event, [{
    role: 'Emp.Mesa', status: 'confirmed', plannedCheckIn: '12:00', plannedCheckOut: '17:00', hourlyRate: 8,
  }]).totalRevenue, 70);
  assert.equal(calculateEventTotals(event, [{
    role: 'Emp.Mesa', status: 'confirmed', plannedCheckIn: '12:00', plannedCheckOut: '19:00', hourlyRate: 8,
  }]).totalRevenue, 98);
});

test('does not retain an obsolete total after all current commercial rows are removed', () => {
  const totals = calculateEventTotals({
    status: 'drafting',
    totalRevenue: 140,
    totalCost: 80,
    requiredRoles: [],
  }, []);

  assert.equal(totals.totalRevenue, 0);
  assert.equal(totals.totalCost, 0);
});

test('keeps issued client totals immutable while allowing staff costs to be rebuilt', () => {
  const totals = calculateEventTotals({
    totalRevenue: 140,
    taxAmount: 10,
    realHours: 10,
    billableHours: 10,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }],
  }, [{
    role: 'Emp.Mesa',
    status: 'confirmed',
    plannedCheckIn: '12:00',
    plannedCheckOut: '17:00',
    hourlyRate: 9,
  }], { preserveClientTotals: true });

  assert.equal(totals.totalRevenue, 140);
  assert.equal(totals.taxAmount, 10);
  assert.equal(totals.billableHours, 10);
  assert.equal(totals.totalCost, 45);
});

test('forecasts legacy continuous requirements once per active day', () => {
  const totals = calculateEventTotals({
    status: 'drafting',
    isContinuous: true,
    date: '2026-09-01',
    endDate: '2026-09-03',
    cancelledDays: [{ date: '2026-09-02' }],
    startTime: '12:00',
    endTime: '16:00',
    minimumHoursSnapshot: 5,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }],
  }, []);

  assert.equal(totals.billableHours, 10);
  assert.equal(totals.totalRevenue, 140);
});

test('does not multiply explicit continuous-day requirements a second time', () => {
  const totals = calculateEventTotals({
    status: 'drafting',
    isContinuous: true,
    date: '2026-09-01',
    endDate: '2026-09-02',
    startTime: '12:00',
    endTime: '16:00',
    minimumHoursSnapshot: 5,
    requiredRoles: [
      { role: 'Emp.Mesa', day: '2026-09-01', qty: 1, agreedRate: 14 },
      { role: 'Emp.Mesa', day: '2026-09-02', qty: 2, agreedRate: 14 },
    ],
  }, []);

  assert.equal(totals.billableHours, 15);
  assert.equal(totals.totalRevenue, 210);
});
