const SCHEDULE_FIELDS = {
  startTime: { assignment: 'plannedCheckIn', requirement: 'start' },
  endTime: { assignment: 'plannedCheckOut', requirement: 'end' },
};

export function applyInheritedEventScheduleChange(form = {}, field, value) {
  const mapping = SCHEDULE_FIELDS[field];
  if (!mapping) return form;
  const previous = form[field] || '';

  return {
    ...form,
    [field]: value,
    assignments: (form.assignments || []).map((assignment) => {
      const current = assignment[mapping.assignment] || '';
      return !current || current === previous
        ? { ...assignment, [mapping.assignment]: value }
        : assignment;
    }),
    requiredRoles: (form.requiredRoles || []).map((requirement) => {
      const current = requirement[mapping.requirement] || '';
      return !current || current === previous
        ? { ...requirement, [mapping.requirement]: value }
        : requirement;
    }),
  };
}
