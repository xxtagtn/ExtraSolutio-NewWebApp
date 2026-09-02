import assert from 'node:assert/strict';
import test from 'node:test';
import { eventDayKeys } from '../../src/utils/eventCancelledDays.js';
import {
  assignmentsOutsideEventRange,
  partitionAssignmentsOutsideEventRange,
  reconcileEventRangeData,
} from './eventRangeReconciliation.js';

function date(day) {
  return new Date(`${day}T00:00:00.000Z`);
}

test('preserves saved unassigned rows when a partial update omits drafts', () => {
  const original = {
    date: date('2026-08-01'),
    endDate: date('2026-08-03'),
    isContinuous: true,
    assignmentDrafts: JSON.stringify([{ role: 'Barman', assignmentDate: '2026-08-02' }]),
  };

  for (const update of [{ notes: 'Updated' }, { assignmentDrafts: undefined }]) {
    assert.equal(reconcileEventRangeData(original, update).data.assignmentDrafts, original.assignmentDrafts);
  }
});

test('an explicitly empty draft list clears saved unassigned rows', () => {
  const original = {
    date: date('2026-08-01'),
    endDate: date('2026-08-03'),
    isContinuous: true,
    assignmentDrafts: JSON.stringify([{ role: 'Barman', assignmentDate: '2026-08-02' }]),
  };

  for (const assignmentDrafts of [null, [], '[]']) {
    const result = reconcileEventRangeData(original, { assignmentDrafts });
    assert.equal(result.data.assignmentDrafts, null);
  }
});

test('continuous event can shrink from 30 to 20 days and expand to 30 again', () => {
  const original = {
    date: date('2026-08-01'),
    endDate: date('2026-08-30'),
    isContinuous: true,
    requiredRoles: JSON.stringify([
      { role: 'Emp.Mesa', qty: 2, day: '2026-08-20' },
      { role: 'Barman', qty: 1, day: '2026-08-30' },
    ]),
    assignmentDrafts: JSON.stringify([
      { role: 'Emp.Mesa', assignmentDate: '2026-08-20' },
      { role: 'Barman', assignmentDate: '2026-08-30' },
    ]),
    cancelledDays: JSON.stringify([{ date: '2026-08-30' }]),
  };
  assert.equal(eventDayKeys(original).length, 30);

  const shrunk = reconcileEventRangeData(original, { endDate: date('2026-08-20') });
  assert.equal(eventDayKeys(shrunk.nextEvent).length, 20);
  assert.deepEqual(JSON.parse(shrunk.data.requiredRoles).map((item) => item.day), ['2026-08-20']);
  assert.deepEqual(JSON.parse(shrunk.data.assignmentDrafts).map((item) => item.assignmentDate), ['2026-08-20']);
  assert.equal(shrunk.data.cancelledDays, null);

  const expanded = reconcileEventRangeData(
    { ...shrunk.nextEvent, ...shrunk.data },
    { endDate: date('2026-08-30') },
  );
  assert.equal(eventDayKeys(expanded.nextEvent).length, 30);
});

test('detects collaborators associated with days outside the shortened range', () => {
  const event = {
    date: date('2026-08-01'),
    endDate: date('2026-08-20'),
    isContinuous: true,
  };
  const outside = assignmentsOutsideEventRange([
    { id: 1, assignmentDate: date('2026-08-20') },
    { id: 2, assignmentDate: date('2026-08-21') },
  ], event);
  assert.deepEqual(outside.map((item) => item.id), [2]);
});

test('allows cancelled assignments outside the shortened range to be removed permanently', () => {
  const event = {
    date: date('2026-08-01'),
    endDate: date('2026-08-20'),
    isContinuous: true,
  };
  const result = partitionAssignmentsOutsideEventRange([
    { id: 20, assignmentDate: date('2026-08-20'), status: 'confirmed' },
    { id: 21, assignmentDate: date('2026-08-21'), status: 'cancelled' },
    { id: 22, assignmentDate: date('2026-08-22'), status: 'confirmed' },
  ], event);

  assert.deepEqual(result.removable.map((item) => item.id), [21]);
  assert.deepEqual(result.blocking.map((item) => item.id), [22]);
});
