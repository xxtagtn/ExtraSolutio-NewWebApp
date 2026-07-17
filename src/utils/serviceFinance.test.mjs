import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignmentStaffCost,
  assignmentStaffRate,
  clientChargeHours,
  clientRealHours,
  collaboratorHourlyRate,
  decimalValue,
  staffWorkedHours,
} from './serviceFinance.js';

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

test('does not use client validated hours to calculate Staff payment', () => {
  assert.equal(staffWorkedHours({
    validatedCheckIn: '09:00',
    validatedCheckOut: '17:00',
    staffPayableHours: 6,
  }), 6);
});
