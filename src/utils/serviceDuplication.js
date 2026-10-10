const planningFields = [
  'eventType', 'date', 'endDate', 'isContinuous', 'clientId', 'clientName',
  'useDefaultLocation', 'location', 'guestsCount', 'startTime', 'endTime',
  'uniform', 'uniformOther', 'meetingPoint', 'onsiteContactName', 'onsiteContactPhone',
  'travelExpenseEnabled', 'travelExpenseAmount', 'travelType', 'travelPeople',
  'km', 'kmRate', 'durationHours', 'travelStaffHourlyRate', 'split5050',
  'travelManualAmount', 'workLocationsEnabled', 'vatRateSnapshot',
];

export function emptyAssignmentForRole(role, assignmentDate = '') {
  return {
    role, collaboratorId: '', assignmentDate, collaboratorSearch: '',
    plannedCheckIn: '', plannedCheckOut: '', checkIn: '', checkOut: '',
    clientCheckIn: '', clientCheckOut: '', validatedCheckIn: '', validatedCheckOut: '',
    hoursWorked: 0, clientBillableHours: 0, staffPayableHours: 0, hourlyRate: '',
    workLocationId: '', validationStatus: 'pending', validationNotes: '',
    clientSynced: false, isDriver: false, advancePayments: [], status: 'pending_confirmation',
  };
}

// Only planning fields are copied; identities and operational history stay in the source.
export function buildServiceDuplicateForm(source, defaults, { includeTeam = false } = {}) {
  const form = { ...defaults };
  for (const field of planningFields) {
    if (source[field] !== undefined) form[field] = source[field];
  }
  form.name = source.name ? `Cópia de ${source.name}` : '';
  form.description = String(source.description || '')
    .replace(/\[(?:BUDGET_REF:[^\]]*|EVENT_VALIDATED_HOURS)\]/gi, '').trim();
  form.travelCars = (source.travelCars || []).map((car, index) => ({
    id: `car-${index + 1}`, label: car.label || `Carro ${index + 1}`,
    km: car.km, kmRate: car.kmRate, durationHours: car.durationHours,
    travelPeople: car.travelPeople, travelStaffHourlyRate: car.travelStaffHourlyRate,
  }));
  form.workLocations = (source.workLocations || [])
    .map((location) => String(typeof location === 'string' ? location : location.name || '').trim())
    .filter(Boolean);
  form.requiredRoles = (source.requiredRoles || []).map((requirement) => ({
    role: requirement.role, qty: requirement.qty, agreedRate: requirement.agreedRate,
    ...(requirement.day ? { day: requirement.day } : {}),
    ...(requirement.start ? { start: requirement.start } : {}),
    ...(requirement.end ? { end: requirement.end } : {}),
    ...(requirement.order !== undefined ? { order: requirement.order } : {}),
  }));
  form.assignments = (source.assignments || [])
    .filter((assignment) => !['cancelled', 'missed_justified', 'missed_unjustified'].includes(assignment.status))
    .map((assignment) => ({
    ...emptyAssignmentForRole(assignment.role, assignment.assignmentDate || ''),
    plannedCheckIn: assignment.plannedCheckIn || '',
    plannedCheckOut: assignment.plannedCheckOut || '',
    collaboratorId: includeTeam && ['confirmed', 'pending_confirmation'].includes(assignment.status)
      ? assignment.collaboratorId : '',
    isDriver: Boolean(assignment.isDriver),
    }));
  return form;
}

function dayTimestamp(value) {
  const day = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  return Date.parse(`${day}T00:00:00Z`);
}

export function shiftDuplicatedServiceStart(form, date) {
  const offset = dayTimestamp(date) - dayTimestamp(form.date);
  if (!Number.isFinite(offset) || !offset) return { ...form, date };
  const shift = (day) => {
    const timestamp = dayTimestamp(day);
    return Number.isFinite(timestamp) ? new Date(timestamp + offset).toISOString().slice(0, 10) : day;
  };
  return {
    ...form, date,
    endDate: form.isContinuous ? shift(form.endDate) : form.endDate,
    requiredRoles: form.requiredRoles.map((requirement) => (
      requirement.day ? { ...requirement, day: shift(requirement.day) } : requirement
    )),
    assignments: form.assignments.map((assignment) => (
      assignment.assignmentDate ? { ...assignment, assignmentDate: shift(assignment.assignmentDate) } : assignment
    )),
  };
}
