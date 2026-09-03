const SCHEDULE_FIELDS = [
  { event: 'startTime', assignment: 'plannedCheckIn' },
  { event: 'endTime', assignment: 'plannedCheckOut' },
];

export function inheritedAssignmentScheduleChanges(existing = {}, data = {}) {
  return SCHEDULE_FIELDS.flatMap(({ event, assignment }) => {
    if (data[event] === undefined || data[event] === existing[event]) return [];
    return [{
      field: assignment,
      previous: existing[event] || null,
      next: data[event] || null,
    }];
  });
}
