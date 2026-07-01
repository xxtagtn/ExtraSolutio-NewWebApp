import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditableTeamRows,
  editableTeamRowsToAssignmentDrafts,
  editableTeamRowsToAssignmentPayloads,
  groupAssignmentsByRole,
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

test('groupAssignmentsByRole filters by selected date and sorts names', () => {
  const groups = groupAssignmentsByRole([
    { role: 'Emp.Mesa', assignmentDate: '2026-06-17', collaborator: { shortName: 'Miriam' } },
    { role: 'Emp.Mesa', assignmentDate: '2026-06-17', collaborator: { shortName: 'Ana' } },
    { role: 'Barman', assignmentDate: '2026-06-18', collaborator: { shortName: 'Carlos' } },
  ], {}, '2026-06-17');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].role, 'Emp.Mesa');
  assert.deepEqual(groups[0].rows.map((row) => row.collaborator.shortName), ['Ana', 'Miriam']);
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
