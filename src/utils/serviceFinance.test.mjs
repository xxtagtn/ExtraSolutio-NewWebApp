import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignmentStaffCost,
  assignmentStaffRate,
  clientChargeHours,
  clientRealHours,
  collaboratorHourlyRate,
  decimalValue,
  roundedBillableHours,
  roundedClockTime,
  staffPaymentHours,
  staffWorkedHours,
} from './serviceFinance.js';

test('rounds each clock value to the ExtraSolutio half-hour rule', () => {
  const cases = [
    ['22:45', '23:00'],
    ['22:58', '23:00'],
    ['23:00', '23:00'],
    ['23:14', '23:00'],
    ['23:15', '23:30'],
    ['23:29', '23:30'],
    ['23:44', '23:30'],
    ['23:45', '00:00'],
  ];

  for (const [recorded, expected] of cases) {
    assert.equal(roundedClockTime(recorded), expected, recorded);
  }
});

test('rounds entry and exit before calculating service duration', () => {
  assert.equal(roundedBillableHours('17:43', '23:16'), 6);
  assert.equal(roundedBillableHours('18:12', '23:44'), 5.5);
});

test('applies the same rule to shifts that cross midnight', () => {
  assert.equal(roundedBillableHours('19:08', '00:46'), 6);
});

test('does not recover stale hours when a complete rounded pair results in zero', () => {
  const assignment = {
    clientCheckIn: '23:45',
    clientCheckOut: '00:14',
    clientRealHours: 8,
    clientBillableHours: 8,
    staffPayableHours: 8,
  };

  assert.equal(clientRealHours(assignment), 0);
  assert.equal(clientChargeHours(assignment), 0);
  assert.equal(staffPaymentHours(assignment), 0);
});

test('uses collaborator hourly rate when assignment rate is empty', () => {
  const collaborators = new Map([['7', { id: 7, hourlyRate: '8,50€' }]]);

  assert.equal(
    assignmentStaffRate({ collaboratorId: '7', hourlyRate: '' }, collaborators),
    8.5,
  );
});

test('uses collaborator hourly rate when assignment rate equals client role rate', () => {
  const collaborators = new Map([['7', { id: 7, hourlyRate: '8,50€' }]]);

  assert.equal(
    assignmentStaffRate({ collaboratorId: '7', hourlyRate: '12,00€' }, collaborators, 12),
    8.5,
  );
});

test('keeps a manual event-specific staff rate', () => {
  const collaborators = new Map([['7', { id: 7, hourlyRate: '8,50€' }]]);

  assert.equal(
    assignmentStaffRate({ collaboratorId: '7', hourlyRate: '9,25€' }, collaborators, 12),
    9.25,
  );
});

test('keeps a manually touched staff rate even when it matches client role rate', () => {
  const collaborators = new Map([['7', { id: 7, hourlyRate: '8,50€' }]]);

  assert.equal(
    assignmentStaffRate({ collaboratorId: '7', hourlyRate: '12,00€', manualHourlyRate: true }, collaborators, 12),
    12,
  );
});

test('calculates staff cost from worked hours and collaborator rate', () => {
  const collaborators = new Map([['7', { id: 7, hourlyRate: '8,50€' }]]);

  assert.equal(
    assignmentStaffCost({ collaboratorId: '7', hourlyRate: '' }, 6, collaborators),
    51,
  );
});

test('parses collaborator hourly rate with comma cents', () => {
  assert.equal(collaboratorHourlyRate({ hourlyRate: '10,50€' }), 10.5);
});

test('parses client hourly rate typed with euro per hour suffix', () => {
  assert.equal(decimalValue('10,50€/h'), 10.5);
});

test('uses validated ES hours before stale explicit client hours', () => {
  assert.equal(
    clientChargeHours({
      validatedCheckIn: '15:00',
      validatedCheckOut: '05:00',
      clientBillableHours: 10,
    }),
    14,
  );
});

test('uses client reported hours before stale explicit client hours', () => {
  assert.equal(
    clientChargeHours({
      clientCheckIn: '15:00',
      clientCheckOut: '04:00',
      clientBillableHours: 10,
    }),
    13,
  );
});

test('uses Staff hours before a stale explicit client total', () => {
  assert.equal(
    clientChargeHours({
      checkIn: '15:00',
      checkOut: '05:00',
      clientBillableHours: 10,
    }),
    14,
  );
});

test('uses each assignment planned shift before the general event schedule', () => {
  assert.equal(clientChargeHours({
    plannedCheckIn: '19:00',
    plannedCheckOut: '23:00',
  }, '11:30', '16:00'), 4);
});

test('keeps explicit client hours when no Staff, Client or validated times exist', () => {
  assert.equal(clientChargeHours({ clientBillableHours: 10 }, '11:30', '16:00'), 10);
});

test('keeps real client hours separate from the client minimum', () => {
  const assignment = {
    clientCheckIn: '09:00',
    clientCheckOut: '12:00',
  };

  assert.equal(clientRealHours(assignment), 3);
  assert.equal(clientChargeHours(assignment, '', '', 5), 5);
});

test('uses real client hours when they exceed the client minimum', () => {
  const assignment = {
    clientCheckIn: '09:00',
    clientCheckOut: '15:00',
  };

  assert.equal(clientRealHours(assignment), 6);
  assert.equal(clientChargeHours(assignment, '', '', 5), 6);
});

test('does not apply a minimum when the client has none configured', () => {
  const assignment = {
    clientCheckIn: '09:00',
    clientCheckOut: '13:30',
  };

  assert.equal(clientChargeHours(assignment, '', '', 0), 4.5);
});

test('uses persisted real client hours before different staff hours', () => {
  assert.equal(clientRealHours({
    checkIn: '09:00',
    checkOut: '15:00',
    clientRealHours: 4.5,
  }), 4.5);
});

test('uses each row staff times before stale aggregate staff hours', () => {
  const morningShift = staffWorkedHours({
    checkIn: '11:27',
    checkOut: '15:53',
    staffPayableHours: 11.5,
    hoursWorked: 11.5,
  });

  const eveningShift = staffWorkedHours({
    checkIn: '19:33',
    checkOut: '23:15',
    staffPayableHours: 11.5,
    hoursWorked: 11.5,
  });

  assert.equal(morningShift, 4.5);
  assert.equal(eveningShift, 4);
  assert.equal(Number((morningShift + eveningShift).toFixed(2)), 8.5);
});

test('keeps stored staff hours when no row times exist', () => {
  assert.equal(staffWorkedHours({
    staffPayableHours: 5,
    hoursWorked: 4,
  }), 5);
});

test('uses validated client hours to calculate Staff payment', () => {
  assert.equal(staffPaymentHours({
    validatedCheckIn: '09:00',
    validatedCheckOut: '17:00',
    staffPayableHours: 6,
  }), 8);
});

test('uses client reported hours before different Staff hours for payment', () => {
  assert.equal(staffPaymentHours({
    checkIn: '09:00',
    checkOut: '15:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
    staffPayableHours: 6,
  }), 8);
});

test('keeps Staff hours as fallback for legacy payments without client hours', () => {
  assert.equal(staffPaymentHours({
    staffPayableHours: 6,
  }), 6);
});
