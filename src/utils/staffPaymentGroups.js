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
