import { staffAssignmentPaymentBalance } from './staffPayment.js';

export function groupStaffPaymentEntries(entries = []) {
  const groups = new Map();

  for (const assignment of entries) {
    const collaboratorId = assignment.collaboratorId ?? assignment.collaborator?.id;
    const key = collaboratorId == null
      ? `assignment:${assignment.id}`
      : `collaborator:${collaboratorId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        collaborator: assignment.collaborator || null,
        assignments: [],
      };
      groups.set(key, group);
    }
    group.assignments.push(assignment);
  }

  return [...groups.values()];
}

export function createStaffPaymentGroupSnapshot(groups = []) {
  return groups.map((group) => ({
    key: group.key,
    assignmentIds: group.assignments.map((assignment) => String(assignment.id)),
  }));
}

export function restoreStaffPaymentSnapshotGroups(entries = [], snapshot = [], matches = () => true) {
  if (!snapshot.length) return groupStaffPaymentEntries(entries);

  const entriesById = new Map(entries.map((assignment) => [String(assignment.id), assignment]));
  return snapshot.flatMap((group) => {
    const assignments = group.assignmentIds
      .map((id) => entriesById.get(String(id)))
      .filter((assignment) => assignment && matches(assignment));
    if (!assignments.length) return [];
    return [{
      key: group.key,
      collaborator: assignments[0].collaborator || null,
      assignments,
    }];
  });
}

export function summarizeStaffPaymentAmounts(assignments = []) {
  const fields = ['base', 'total', 'vat', 'receiptBase', 'receiptTotal', 'advances', 'car'];
  const zero = () => Object.fromEntries(fields.map((field) => [field, 0]));
  const cents = { total: zero(), paid: zero(), outstanding: zero() };
  for (const assignment of assignments) {
    const amount = staffAssignmentPaymentBalance(assignment);
    const state = assignment.paymentStatus === 'paid' ? 'paid' : 'outstanding';
    for (const field of fields) {
      const value = Math.round(amount[field] * 100);
      cents.total[field] += value;
      cents[state][field] += value;
    }
  }
  return Object.fromEntries(Object.entries(cents).map(([state, amounts]) => [state,
    Object.fromEntries(fields.map((field) => [field, amounts[field] / 100])),
  ]));
}
