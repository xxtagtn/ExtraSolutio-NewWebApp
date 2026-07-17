import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditableTeamRows,
  createManualTeamRow,
  editableTeamRowsToAssignmentDrafts,
  editableTeamRowsToAssignmentPayloads,
  groupAssignmentsByRole,
  normalizeDailyRoleRequirements,
  resolveSelectedTeamDay,
  roleRequirementsForDay,
  serviceAssignmentDays,
  serviceChecklist,
  serviceDetailMetrics,
} from './serviceDetail.js';

test('serviceDetailMetrics ignores cancelled and missed assignments', () => {
  const metrics = serviceDetailMetrics({
    requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty: 2 }]),
    assignments: [
      { collaboratorId: 1, status: 'confirmed', checkIn: '10:00', checkOut: '14:00', clientCheckIn: '10:00', clientCheckOut: '14:00', validationStatus: 'validated' },
      { collaboratorId: 2, status: 'cancelled', checkIn: '10:00', checkOut: '14:00', clientCheckIn: '10:00', clientCheckOut: '14:00', validationStatus: 'validated' },
      { collaboratorId: 3, status: 'missed_justified' },
    ],
  });

  assert.equal(metrics.requested, 2);
  assert.equal(metrics.assigned, 1);
  assert.equal(metrics.confirmed, 1);
  assert.equal(metrics.staffFilled, 1);
  assert.equal(metrics.clientFilled, 1);
  assert.equal(metrics.validationComplete, true);
});

test('serviceChecklist exposes incomplete client hours before finance readiness', () => {
  const checklist = serviceChecklist({
    requiredRoles: [{ role: 'Barman', qty: 1 }],
    assignments: [
      { collaboratorId: 1, status: 'confirmed', checkIn: '18:00', checkOut: '23:00', validationStatus: 'pending' },
    ],
  });

  assert.equal(checklist.find((item) => item.id === 'team').done, true);
  assert.equal(checklist.find((item) => item.id === 'staff').done, true);
  assert.equal(checklist.find((item) => item.id === 'client').done, false);
  assert.equal(checklist.find((item) => item.id === 'finance').done, false);
});

test('continuous event metrics use scheduled rows instead of the global role quantity', () => {
  const metrics = serviceDetailMetrics({
    isContinuous: true,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }],
    assignments: [
      { collaboratorId: 1, role: 'Emp.Mesa', assignmentDate: '2026-06-17', status: 'confirmed' },
      { collaboratorId: 2, role: 'Emp.Mesa', assignmentDate: '2026-06-18', status: 'confirmed' },
      { collaboratorId: 3, role: 'Emp.Mesa', assignmentDate: '2026-06-19', status: 'pending_confirmation' },
    ],
  });

  assert.equal(metrics.requested, 3);
  assert.equal(metrics.confirmed, 2);
  assert.equal(metrics.teamComplete, false);
});

test('continuous event metrics include empty saved drafts as planned slots', () => {
  const metrics = serviceDetailMetrics({
    isContinuous: true,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }],
    assignments: [
      { collaboratorId: 1, role: 'Emp.Mesa', assignmentDate: '2026-06-17', status: 'confirmed' },
    ],
    assignmentDrafts: JSON.stringify([
      { role: 'Emp.Mesa', assignmentDate: '2026-06-18' },
    ]),
  });

  assert.equal(metrics.requested, 2);
  assert.equal(metrics.assigned, 1);
  assert.equal(metrics.teamComplete, false);
});

test('serviceAssignmentDays returns continuous event days and assignment dates chronologically', () => {
  const days = serviceAssignmentDays({
    date: '2026-06-17T00:00:00.000Z',
    endDate: '2026-06-19T00:00:00.000Z',
    assignments: [
      { assignmentDate: '2026-06-20T00:00:00.000Z' },
    ],
  });

  assert.deepEqual(days, ['2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20']);
});

test('groupAssignmentsByRole filters by selected date and keeps the editing order stable', () => {
  const groups = groupAssignmentsByRole([
    { role: 'Emp.Mesa', assignmentDate: '2026-06-17', collaborator: { shortName: 'Miriam' } },
    { role: 'Emp.Mesa', assignmentDate: '2026-06-17', collaborator: { shortName: 'Ana' } },
    { role: 'Barman', assignmentDate: '2026-06-18', collaborator: { shortName: 'Carlos' } },
  ], {}, '2026-06-17');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].role, 'Emp.Mesa');
  assert.deepEqual(groups[0].rows.map((row) => row.collaborator.shortName), ['Miriam', 'Ana']);
});

test('buildEditableTeamRows creates missing rows from required roles', () => {
  const rows = buildEditableTeamRows({
    id: 8,
    date: '2027-05-11',
    startTime: '12:00',
    endTime: '18:00',
    requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 10 }],
    assignments: [],
    assignmentDrafts: [],
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.role), ['Emp.Mesa', 'Emp.Mesa', 'Emp.Mesa']);
  assert.deepEqual(rows.map((row) => row.plannedCheckIn), ['12:00', '12:00', '12:00']);
  assert.equal(rows.every((row) => row.isDraft), true);
});

test('legacy continuous role requirements are expanded to every event day', () => {
  const event = {
    isContinuous: true,
    date: '2026-09-01',
    endDate: '2026-09-03',
    requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 10.5 }],
  };
  const roles = normalizeDailyRoleRequirements(event);

  assert.equal(roles.length, 3);
  assert.deepEqual(roles.map((item) => item.day), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(roles.every((item) => item.role === 'Emp.Mesa' && item.qty === 2), true);
  assert.equal(buildEditableTeamRows(event).length, 6);
});

test('continuous event role requirements stay independent per day', () => {
  const event = {
    isContinuous: true,
    date: '2026-09-01',
    endDate: '2026-09-03',
    requiredRoles: [
      { role: 'Emp.Mesa', qty: 4, day: '2026-09-01', order: 0 },
      { role: 'Barman', qty: 2, day: '2026-09-01', order: 1 },
      { role: 'Emp.Mesa', qty: 2, day: '2026-09-02', order: 0 },
      { role: 'Chefe de Sala', qty: 1, day: '2026-09-03', order: 0 },
    ],
  };
  const roles = normalizeDailyRoleRequirements(event);

  assert.deepEqual(roleRequirementsForDay(event, '2026-09-01', roles).map((item) => [item.role, item.qty]), [
    ['Emp.Mesa', 4],
    ['Barman', 2],
  ]);
  assert.deepEqual(roleRequirementsForDay(event, '2026-09-02', roles).map((item) => [item.role, item.qty]), [['Emp.Mesa', 2]]);
  assert.deepEqual(roleRequirementsForDay(event, '2026-09-03', roles).map((item) => [item.role, item.qty]), [['Chefe de Sala', 1]]);
});

test('legacy rows without a role are aligned with the selected day requirement', () => {
  const rows = buildEditableTeamRows({
    isContinuous: true,
    date: '2026-09-01',
    endDate: '2026-09-02',
    requiredRoles: [
      { role: 'Emp.Mesa', qty: 1, day: '2026-09-01' },
      { role: 'Barman', qty: 1, day: '2026-09-02' },
    ],
    assignments: [{
      id: 10,
      collaboratorId: 4,
      role: 'Sem função',
      assignmentDate: '2026-09-02',
      collaborator: { roles: ['Barman'] },
    }],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === 10).role, 'Barman');
  assert.equal(rows.some((row) => row.role === 'Sem função'), false);
});

test('role groups follow the configured order for the selected day', () => {
  const event = {
    isContinuous: true,
    requiredRoles: [
      { role: 'Barman', qty: 1, day: '2026-09-01', order: 1 },
      { role: 'Emp.Mesa', qty: 1, day: '2026-09-01', order: 0 },
    ],
  };
  const groups = groupAssignmentsByRole([
    { role: 'Barman', assignmentDate: '2026-09-01' },
    { role: 'Emp.Mesa', assignmentDate: '2026-09-01' },
  ], event, '2026-09-01');

  assert.deepEqual(groups.map((group) => group.role), ['Emp.Mesa', 'Barman']);
});

test('createManualTeamRow adds a directly editable collaborator slot to the selected event day', () => {
  const row = createManualTeamRow({
    id: 9,
    isContinuous: true,
    date: '2026-06-21',
    startTime: '10:00',
    endTime: '18:00',
  }, {
    role: 'Emp.Mesa',
    selectedDay: '2026-06-23',
    rowKey: 'manual-test-row',
  });

  assert.deepEqual(row, {
    rowKey: 'manual-test-row',
    role: 'Emp.Mesa',
    collaboratorId: '',
    assignmentDate: '2026-06-23',
    plannedCheckIn: '10:00',
    plannedCheckOut: '18:00',
    hourlyRate: '',
    status: 'pending_confirmation',
    clientSynced: false,
    isDriver: false,
    isDraft: true,
  });

  const drafts = editableTeamRowsToAssignmentDrafts([row]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].assignmentDate, '2026-06-23');
  assert.equal(drafts[0].role, 'Emp.Mesa');
});

test('editable team rows split assigned rows from empty saved drafts', () => {
  const rows = [
    {
      rowKey: 'new-1',
      role: 'Emp.Mesa',
      collaboratorId: '12',
      assignmentDate: '2027-05-11',
      plannedCheckIn: '12:00',
      plannedCheckOut: '18:00',
      hourlyRate: '8.50',
      status: 'confirmed',
      clientSynced: true,
      isDriver: false,
    },
    {
      rowKey: 'new-2',
      role: 'Emp.Mesa',
      collaboratorId: '',
      assignmentDate: '2027-05-11',
      plannedCheckIn: '12:00',
      plannedCheckOut: '18:00',
      hourlyRate: '',
      status: 'pending_confirmation',
    },
  ];

  const payloads = editableTeamRowsToAssignmentPayloads(rows, { id: 8 });
  const drafts = editableTeamRowsToAssignmentDrafts(rows);

  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0], {
    eventId: 8,
    collaboratorId: 12,
    assignmentDate: '2027-05-11',
    role: 'Emp.Mesa',
    plannedCheckIn: '12:00',
    plannedCheckOut: '18:00',
    hourlyRate: 8.5,
    status: 'confirmed',
    clientSynced: true,
    isDriver: false,
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].role, 'Emp.Mesa');
  assert.equal(drafts[0].collaboratorId, undefined);
});

test('keeps the selected continuous event day when it is still available', () => {
  assert.equal(resolveSelectedTeamDay({
    isContinuous: true,
    days: ['2026-06-01', '2026-06-02', '2026-06-03'],
    selectedDay: '2026-06-02',
  }), '2026-06-02');
});

test('falls back to the first continuous event day only when the selected day is invalid', () => {
  assert.equal(resolveSelectedTeamDay({
    isContinuous: true,
    days: ['2026-06-01', '2026-06-02'],
    selectedDay: '2026-06-09',
  }), '2026-06-01');
  assert.equal(resolveSelectedTeamDay({
    isContinuous: false,
    days: ['2026-06-01'],
    selectedDay: '2026-06-01',
  }), '');
});
