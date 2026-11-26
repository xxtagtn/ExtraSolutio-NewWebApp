import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFinanceEventDescriptors,
  eventTurnCount,
  financeEventOperationalSummary,
} from './financeEventIdentity.js';

test('LX Factory summary displays exact validated client clocks without changing rounded billing', () => {
  const event = { id: 42, date: '2026-11-06', startTime: '17:00', endTime: '22:00',
    minimumHoursSnapshot: 0, requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 10.2 }],
    assignments: [{ id: 1, collaboratorId: 1, role: 'Emp.Mesa', status: 'confirmed',
      plannedCheckIn: '17:00', plannedCheckOut: '22:00', checkIn: '17:01', checkOut: '22:04',
      clientCheckIn: '17:05', clientCheckOut: '21:50',
      validatedCheckIn: '17:10', validatedCheckOut: '21:56', validationStatus: 'validated' }] };
  const before = structuredClone(event);
  const summary = financeEventOperationalSummary(event);
  const entry = summary.days[0].entries[0];
  assert.equal(entry.validatedScheduleLabel, '17:10 - 21:56');
  assert.equal(entry.label, '17:00 - 22:00', 'Billing groups keep their existing rounded interval');
  assert.equal(entry.billableHours, 5);
  assert.equal(entry.billableValue, 51);
  assert.equal(summary.billableHours, 5);
  assert.equal(summary.scheduleCount, 1);
  assert.deepEqual(event, before);
});

test('summary uses complete client clock pairs, preserving minutes and overnight schedules', () => {
  const summary = financeEventOperationalSummary({ assignments: [
    { id: 1, collaboratorId: 1, status: 'confirmed', clientCheckIn: '17:10:30', clientCheckOut: '21:56:59' },
    { id: 2, collaboratorId: 2, status: 'confirmed', validatedCheckIn: '23:47', validatedCheckOut: '02:12',
      clientCheckIn: '23:00', clientCheckOut: '02:00' },
    { id: 3, collaboratorId: 3, status: 'confirmed', validatedCheckIn: '16:12',
      clientCheckIn: '17:10', clientCheckOut: '21:56' },
  ] });
  const entries = summary.days.flatMap((day) => day.entries);
  assert.equal(entries.find((entry) => entry.collaboratorKey === '1').validatedScheduleLabel, '17:10 - 21:56');
  assert.equal(entries.find((entry) => entry.collaboratorKey === '2').validatedScheduleLabel, '23:47 - 02:12');
  assert.equal(entries.find((entry) => entry.collaboratorKey === '3').validatedScheduleLabel, '17:10 - 21:56');
});

test('summary never presents planned or staff clocks as validated client clocks', () => {
  const summary = financeEventOperationalSummary({ startTime: '17:00', endTime: '22:00',
    assignments: [{ id: 1, collaboratorId: 1, role: 'Emp.Mesa', status: 'confirmed',
      checkIn: '17:03', checkOut: '22:04', plannedCheckIn: '17:00', plannedCheckOut: '22:00',
      validatedCheckIn: '17:10' }] });
  assert.equal(summary.days[0].entries[0].validatedScheduleLabel, 'Horário validado não registado');
});

test('counts distinct turns without counting several collaborators on the same schedule twice', () => {
  const event = {
    date: '2026-07-22',
    assignments: [
      { assignmentDate: '2026-07-22', plannedCheckIn: '12:00', plannedCheckOut: '16:00' },
      { assignmentDate: '2026-07-22', plannedCheckIn: '12:00', plannedCheckOut: '16:00' },
      { assignmentDate: '2026-07-22', plannedCheckIn: '19:00', plannedCheckOut: '23:00' },
    ],
  };

  assert.equal(eventTurnCount(event), 2);
});

test('ignores cancelled assignments when counting turns', () => {
  const event = {
    date: '2026-07-22',
    assignments: [
      { plannedCheckIn: '12:00', plannedCheckOut: '16:00', status: 'confirmed' },
      { plannedCheckIn: '19:00', plannedCheckOut: '23:00', status: 'cancelled' },
    ],
  };

  assert.equal(eventTurnCount(event), 1);
});

test('uses the event schedule when there are no assignment schedules', () => {
  assert.equal(eventTurnCount({
    date: '2026-07-22',
    startTime: '12:00',
    endTime: '16:00',
    assignments: [],
  }), 1);
});

test('adds sequence labels only to indistinguishable services', () => {
  const descriptors = buildFinanceEventDescriptors([
    { id: 1, name: 'Embaixada', date: '2026-07-22', location: 'Hotel Altis', startTime: '12:00', endTime: '16:00' },
    { id: 2, name: 'Embaixada', date: '2026-07-22', location: 'Hotel Altis', startTime: '19:00', endTime: '23:00' },
    { id: 3, name: 'Embaixada', date: '2026-07-22', location: 'Hotel Tivoli', startTime: '12:00', endTime: '16:00' },
  ]);

  assert.equal(descriptors.get('1').sequenceLabel, 'Serviço 1');
  assert.equal(descriptors.get('2').sequenceLabel, 'Serviço 2');
  assert.equal(descriptors.get('3').sequenceLabel, '');
  assert.equal(descriptors.get('3').location, 'Hotel Tivoli');
});

test('groups equal validated client schedules and totals billable hours', () => {
  const summary = financeEventOperationalSummary({
    minimumHoursSnapshot: 0,
    assignments: [
      { collaboratorId: 1, clientCheckIn: '08:04', clientCheckOut: '14:02', status: 'confirmed' },
      { collaboratorId: 2, clientCheckIn: '08:10', clientCheckOut: '14:13', status: 'confirmed' },
      { collaboratorId: 3, clientCheckIn: '10:02', clientCheckOut: '16:04', status: 'confirmed' },
    ],
  });

  assert.equal(summary.scheduleCount, 2);
  assert.equal(summary.collaboratorCount, 3);
  assert.equal(summary.billableHours, 18);
  assert.deepEqual(
    summary.scheduleGroups.map((group) => ({
      label: group.label,
      collaboratorCount: group.collaboratorCount,
      billableHours: group.billableHours,
    })),
    [
      { label: '08:00 - 14:00', collaboratorCount: 2, billableHours: 12 },
      { label: '10:00 - 16:00', collaboratorCount: 1, billableHours: 6 },
    ],
  );
});

test('uses distinct collaborators while retaining every turn in billed hours', () => {
  const summary = financeEventOperationalSummary({
    minimumHoursSnapshot: 5,
    assignments: [
      { collaboratorId: 7, clientCheckIn: '08:00', clientCheckOut: '11:00', status: 'confirmed' },
      { collaboratorId: 7, clientCheckIn: '18:00', clientCheckOut: '22:00', status: 'confirmed' },
      { collaboratorId: 8, clientCheckIn: '18:00', clientCheckOut: '22:00', status: 'confirmed' },
      { collaboratorId: 9, clientCheckIn: '12:00', clientCheckOut: '14:00', status: 'cancelled' },
    ],
  });

  assert.equal(summary.scheduleCount, 2);
  assert.equal(summary.collaboratorCount, 2);
  assert.equal(summary.assignmentCount, 3);
  assert.equal(summary.billableHours, 15);
  assert.equal(summary.scheduleGroups[1].collaboratorCount, 2);
});

test('retains the source assignments and groups schedule details by work day', () => {
  const summary = financeEventOperationalSummary({
    date: '2026-09-01',
    minimumHoursSnapshot: 0,
    assignments: [
      {
        id: 1,
        assignmentDate: '2026-09-01',
        collaboratorId: 10,
        collaborator: { name: 'Miriam Peçanha Oliveira' },
        role: 'Emp. Mesa',
        clientCheckIn: '08:00',
        clientCheckOut: '13:30',
        status: 'confirmed',
      },
      {
        id: 2,
        assignmentDate: '2026-09-01',
        collaboratorId: 11,
        collaborator: { name: 'Ana Carolina Ravenna' },
        role: 'Bar',
        clientCheckIn: '08:00',
        clientCheckOut: '13:30',
        status: 'confirmed',
      },
      {
        id: 3,
        assignmentDate: '2026-09-02',
        collaboratorId: 10,
        collaborator: { name: 'Miriam Peçanha Oliveira' },
        role: 'Emp. Mesa',
        clientCheckIn: '08:00',
        clientCheckOut: '13:30',
        status: 'confirmed',
      },
      {
        id: 4,
        assignmentDate: '2026-09-02',
        collaboratorId: 12,
        collaborator: { name: 'Não faturável' },
        role: 'Bar',
        clientCheckIn: '08:00',
        clientCheckOut: '13:30',
        status: 'cancelled',
      },
    ],
  });

  const group = summary.scheduleGroups[0];
  assert.equal(group.label, '08:00 - 13:30');
  assert.equal(group.collaboratorCount, 2);
  assert.equal(group.assignmentCount, 3);
  assert.equal(group.billableHours, 16.5);
  assert.deepEqual(group.dayGroups.map((day) => ({
    workDate: day.workDate,
    entries: day.entries.map((entry) => ({
      collaboratorName: entry.collaboratorName,
      role: entry.role,
      label: entry.label,
      billableHours: entry.billableHours,
    })),
  })), [
    {
      workDate: '2026-09-01',
      entries: [
        { collaboratorName: 'Ana Carolina Ravenna', role: 'Bar', label: '08:00 - 13:30', billableHours: 5.5 },
        { collaboratorName: 'Miriam Peçanha Oliveira', role: 'Emp. Mesa', label: '08:00 - 13:30', billableHours: 5.5 },
      ],
    },
    {
      workDate: '2026-09-02',
      entries: [
        { collaboratorName: 'Miriam Peçanha Oliveira', role: 'Emp. Mesa', label: '08:00 - 13:30', billableHours: 5.5 },
      ],
    },
  ]);
});

test('orders schedule groups by work date, then by start time, without changing totals', () => {
  const summary = financeEventOperationalSummary({
    minimumHoursSnapshot: 0,
    assignments: [
      {
        id: 1,
        assignmentDate: '2026-09-02',
        collaboratorId: 10,
        collaborator: { name: 'Miriam Peçanha Oliveira' },
        clientCheckIn: '08:00',
        clientCheckOut: '12:00',
        status: 'confirmed',
      },
      {
        id: 2,
        assignmentDate: '2026-09-01',
        collaboratorId: 11,
        collaborator: { name: 'Ana Carolina Ravenna' },
        clientCheckIn: '09:00',
        clientCheckOut: '13:00',
        status: 'confirmed',
      },
      {
        id: 3,
        assignmentDate: '2026-09-01',
        collaboratorId: 12,
        collaborator: { name: 'Diego Garcia Bem' },
        clientCheckIn: '07:00',
        clientCheckOut: '11:00',
        status: 'confirmed',
      },
    ],
  });

  assert.deepEqual(
    summary.scheduleGroups.map((group) => ({
      date: group.dayGroups[0].workDate,
      label: group.label,
    })),
    [
      { date: '2026-09-01', label: '07:00 - 11:00' },
      { date: '2026-09-01', label: '09:00 - 13:00' },
      { date: '2026-09-02', label: '08:00 - 12:00' },
    ],
  );
  assert.equal(summary.scheduleCount, 3);
  assert.equal(summary.billableHours, 12);
});

test('groups existing billed hours and role-rate subtotals by day', () => {
  const summary = financeEventOperationalSummary({
    date: '2026-09-01',
    minimumHoursSnapshot: 5,
    requiredRoles: [
      { role: 'Emp. Mesa', agreedRate: 14 },
      { role: 'Bar', agreedRate: 10 },
    ],
    assignments: [
      {
        id: 1,
        assignmentDate: '2026-09-02',
        collaboratorId: 10,
        collaborator: { name: 'Miriam Peçanha Oliveira' },
        role: 'Emp. Mesa',
        clientCheckIn: '08:00',
        clientCheckOut: '11:00',
        status: 'confirmed',
      },
      {
        id: 2,
        assignmentDate: '2026-09-01',
        collaboratorId: 11,
        collaborator: { name: 'Ana Carolina Ravenna' },
        role: 'Emp. Mesa',
        clientCheckIn: '09:00',
        clientCheckOut: '16:00',
        status: 'confirmed',
      },
      {
        id: 3,
        assignmentDate: '2026-09-01',
        collaboratorId: 12,
        collaborator: { name: 'Diego Garcia Bem' },
        role: 'Bar',
        clientCheckIn: '07:00',
        clientCheckOut: '10:00',
        status: 'confirmed',
      },
      {
        id: 4,
        assignmentDate: '2026-09-01',
        collaboratorId: 11,
        collaborator: { name: 'Ana Carolina Ravenna' },
        role: 'Emp. Mesa',
        clientCheckIn: '18:00',
        clientCheckOut: '19:00',
        status: 'confirmed',
      },
    ],
  });

  assert.deepEqual(summary.days.map((day) => ({
    workDate: day.workDate,
    collaboratorCount: day.collaboratorCount,
    assignmentCount: day.assignmentCount,
    billableHours: day.billableHours,
    billableValue: day.billableValue,
  })), [
    {
      workDate: '2026-09-01',
      collaboratorCount: 2,
      assignmentCount: 3,
      billableHours: 17,
      billableValue: 218,
    },
    {
      workDate: '2026-09-02',
      collaboratorCount: 1,
      assignmentCount: 1,
      billableHours: 5,
      billableValue: 70,
    },
  ]);
  assert.equal(summary.billableHours, 22);
  assert.equal(summary.scheduleCount, 4);
  assert.equal(summary.days[1].entries[0].clientRate, 14);
});
