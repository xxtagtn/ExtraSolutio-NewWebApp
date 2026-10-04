import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStaffPaymentGroupSnapshot,
  groupStaffPaymentEntries,
  restoreStaffPaymentSnapshotGroups,
} from './staffPaymentGroups.js';

test('groups staff payment entries by collaborator while preserving service rows and order', () => {
  const first = { id: 1, collaboratorId: 10, paymentStatus: 'unpaid', collaborator: { id: 10, name: 'Miriam' } };
  const other = { id: 2, collaboratorId: 20, paymentStatus: 'paid', collaborator: { id: 20, name: 'Ana' } };
  const last = { id: 3, collaboratorId: 10, paymentStatus: 'validated_es', collaborator: { id: 10, name: 'Miriam' } };

  const groups = groupStaffPaymentEntries([first, other, last]);

  assert.deepEqual(groups.map((group) => group.key), ['collaborator:10', 'collaborator:20']);
  assert.deepEqual(groups[0].assignments, [first, last]);
  assert.deepEqual(groups[0].assignments.map((assignment) => assignment.paymentStatus), ['unpaid', 'validated_es']);
  assert.deepEqual(groups[1].assignments, [other]);
  assert.equal(groups[0].collaborator.name, 'Miriam');
});

test('keeps rows without a collaborator id separate instead of merging them', () => {
  const groups = groupStaffPaymentEntries([
    { id: 1, collaborator: { name: 'Sem ID' } },
    { id: 2, collaborator: { name: 'Sem ID' } },
  ]);

  assert.deepEqual(groups.map((group) => group.key), ['assignment:1', 'assignment:2']);
});

test('supports an empty payment list', () => {
  assert.deepEqual(groupStaffPaymentEntries(), []);
});

test('preserves collaborator and service order while reading the latest service values', () => {
  const original = [
    { id: 1, collaboratorId: 10, paymentStatus: 'unpaid', collaborator: { id: 10, name: 'Miriam' } },
    { id: 2, collaboratorId: 20, paymentStatus: 'unpaid', collaborator: { id: 20, name: 'Diego' } },
    { id: 3, collaboratorId: 10, paymentStatus: 'unpaid', collaborator: { id: 10, name: 'Miriam' } },
  ];
  const snapshot = createStaffPaymentGroupSnapshot(groupStaffPaymentEntries(original));
  const refreshed = [
    { ...original[1], paymentStatus: 'unpaid' },
    { ...original[2], paymentStatus: 'validated_es' },
    { ...original[0], paymentStatus: 'paid' },
  ];

  const groups = restoreStaffPaymentSnapshotGroups(refreshed, snapshot);

  assert.deepEqual(groups.map((group) => group.key), ['collaborator:10', 'collaborator:20']);
  assert.deepEqual(groups[0].assignments.map(({ id, paymentStatus }) => [id, paymentStatus]), [
    [1, 'paid'],
    [3, 'validated_es'],
  ]);
});

test('moves a changed service out of its old status group while retaining the collaborator group', () => {
  const allServices = [
    { id: 1, collaboratorId: 10, paymentStatus: 'paid', collaborator: { id: 10, name: 'Miriam' } },
    { id: 2, collaboratorId: 10, paymentStatus: 'validated_es', collaborator: { id: 10, name: 'Miriam' } },
  ];
  const snapshot = createStaffPaymentGroupSnapshot(groupStaffPaymentEntries([
    { ...allServices[0], paymentStatus: 'unpaid' },
    { ...allServices[1], paymentStatus: 'unpaid' },
  ]));

  const unpaidGroups = restoreStaffPaymentSnapshotGroups(
    allServices,
    snapshot,
    (assignment) => assignment.paymentStatus === 'unpaid',
  );
  const paidGroups = restoreStaffPaymentSnapshotGroups(
    allServices,
    snapshot,
    (assignment) => assignment.paymentStatus === 'paid',
  );

  assert.deepEqual(unpaidGroups, []);
  assert.deepEqual(paidGroups.map((group) => [group.key, group.assignments.map(({ id }) => id)]), [
    ['collaborator:10', [1]],
  ]);
});

test('preserves collaborator order and remaining services after consecutive status changes', () => {
  const collaborators = [
    { id: 1, name: 'Gicleandson' },
    { id: 2, name: 'Diego' },
    { id: 3, name: 'Miriam' },
    { id: 4, name: 'Outro' },
  ];
  const original = [
    { id: 100, collaboratorId: 1, paymentStatus: 'unpaid', collaborator: collaborators[0] },
    { id: 200, collaboratorId: 2, paymentStatus: 'unpaid', collaborator: collaborators[1] },
    ...Array.from({ length: 50 }, (_, index) => ({
      id: 300 + index,
      collaboratorId: 3,
      paymentStatus: 'unpaid',
      collaborator: collaborators[2],
    })),
    { id: 400, collaboratorId: 4, paymentStatus: 'unpaid', collaborator: collaborators[3] },
  ];
  const snapshot = createStaffPaymentGroupSnapshot(groupStaffPaymentEntries(original));
  const refreshed = original.map((assignment) => {
    if (assignment.id === 300) return { ...assignment, paymentStatus: 'paid' };
    if (assignment.id === 301) return { ...assignment, paymentStatus: 'validated_es' };
    if (assignment.id === 302) return { ...assignment, paymentStatus: 'awaiting_data' };
    return assignment;
  });

  const unpaidGroups = restoreStaffPaymentSnapshotGroups(
    refreshed,
    snapshot,
    (assignment) => assignment.paymentStatus === 'unpaid',
  );

  assert.deepEqual(unpaidGroups.map((group) => group.key), [
    'collaborator:1',
    'collaborator:2',
    'collaborator:3',
    'collaborator:4',
  ]);
  assert.equal(unpaidGroups[0].assignments.length, 1);
  assert.equal(unpaidGroups[2].assignments.length, 47);
  assert.deepEqual(unpaidGroups[2].assignments.slice(0, 3).map(({ id }) => id), [303, 304, 305]);

  const paidGroups = restoreStaffPaymentSnapshotGroups(
    refreshed,
    snapshot,
    (assignment) => assignment.paymentStatus === 'paid',
  );
  const validatedEsGroups = restoreStaffPaymentSnapshotGroups(
    refreshed,
    snapshot,
    (assignment) => assignment.paymentStatus === 'validated_es',
  );
  const awaitingDataGroups = restoreStaffPaymentSnapshotGroups(
    refreshed,
    snapshot,
    (assignment) => assignment.paymentStatus === 'awaiting_data',
  );
  const completedChanges = refreshed.map((assignment) => (
    assignment.id === 301 || assignment.id === 302
      ? { ...assignment, paymentStatus: 'paid' }
      : assignment
  ));
  const paidAfterSeveralChanges = restoreStaffPaymentSnapshotGroups(
    completedChanges,
    snapshot,
    (assignment) => assignment.paymentStatus === 'paid',
  );
  assert.deepEqual(paidGroups.flatMap((group) => group.assignments.map(({ id }) => id)), [300]);
  assert.deepEqual(validatedEsGroups.flatMap((group) => group.assignments.map(({ id }) => id)), [301]);
  assert.deepEqual(awaitingDataGroups.flatMap((group) => group.assignments.map(({ id }) => id)), [302]);
  assert.deepEqual(paidAfterSeveralChanges.flatMap((group) => group.assignments.map(({ id }) => id)), [300, 301, 302]);
});
