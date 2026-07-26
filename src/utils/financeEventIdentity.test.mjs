import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFinanceEventDescriptors,
  eventTurnCount,
  financeEventOperationalSummary,
} from './financeEventIdentity.js';

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
