import { activeEventDayKeys, eventDayKey, isAssignmentOnCancelledDay, isEventDayCancelled } from './eventCancelledDays.js';

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
  form.requiredRoles = (source.requiredRoles || [])
    .filter((requirement) => !requirement.day || !isEventDayCancelled(source, requirement.day))
    .map((requirement) => ({
      role: requirement.role, qty: requirement.qty, agreedRate: requirement.agreedRate,
      ...(requirement.day ? { day: requirement.day } : {}),
      ...(requirement.start ? { start: requirement.start } : {}),
      ...(requirement.end ? { end: requirement.end } : {}),
      ...(requirement.order !== undefined ? { order: requirement.order } : {}),
    }));
  form.assignments = (source.assignments || [])
    .filter((assignment) => !['cancelled', 'missed_justified', 'missed_unjustified'].includes(assignment.status))
    .filter((assignment) => !isAssignmentOnCancelledDay(assignment, source))
    .map((assignment) => ({
      ...emptyAssignmentForRole(assignment.role, assignment.assignmentDate || ''),
      plannedCheckIn: assignment.plannedCheckIn || '',
      plannedCheckOut: assignment.plannedCheckOut || '',
      collaboratorId: includeTeam && ['confirmed', 'pending_confirmation'].includes(assignment.status)
        ? assignment.collaboratorId : '',
      isDriver: Boolean(assignment.isDriver),
    }));
  return synchronizeDuplicatedServiceDays(form);
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

// Prune the actual draft data, not only the visible day tabs. Missing/invalid
// intermediate dates must remain editable and are checked by the existing save validation.
export function synchronizeDuplicatedServiceDays(form) {
  if (!Number.isFinite(dayTimestamp(form.date))) return form;
  if (form.isContinuous && (!Number.isFinite(dayTimestamp(form.endDate)) || form.endDate < form.date)) return form;
  const days = new Set(activeEventDayKeys(form));
  const assignments = (form.assignments || []).filter((assignment) => (
    days.has(eventDayKey(assignment.assignmentDate || form.date))
  ));
  const requiredRoles = (form.requiredRoles || []).filter((requirement) => (
    !requirement.day || days.has(eventDayKey(requirement.day))
  ));
  if (assignments.length === (form.assignments || []).length && requiredRoles.length === (form.requiredRoles || []).length) return form;
  return { ...form, assignments, requiredRoles };
}

export function createDuplicatePeriodDraft(form) {
  return {
    assignments: [], requiredRoles: [],
    startDate: form.date, endDate: form.isContinuous ? form.endDate : form.date,
    anchorDate: form.date,
  };
}

function sameRows(a = [], b = []) {
  return a.length === b.length && a.every((row, index) => row === b[index]);
}

// Out-of-period rows live only in this temporary modal draft. They are restored
// by date when the range grows, but never included in the saved event payload.
export function updateDuplicatePeriodDraft(form, retained, { relocate = false } = {}) {
  const start = eventDayKey(form.date);
  const end = form.isContinuous ? eventDayKey(form.endDate) : start;
  if (!Number.isFinite(dayTimestamp(start)) || !Number.isFinite(dayTimestamp(end)) || end < start) {
    return { form, retained };
  }
  let all = {
    ...form,
    assignments: [...new Set([...(form.assignments || []), ...retained.assignments])]
      .sort((a, b) => eventDayKey(a.assignmentDate).localeCompare(eventDayKey(b.assignmentDate))),
    requiredRoles: [...new Set([...(form.requiredRoles || []), ...retained.requiredRoles])]
      .sort((a, b) => eventDayKey(a.day).localeCompare(eventDayKey(b.day))),
  };
  let mapping = retained;
  const plannedDays = [retained.startDate, retained.endDate,
    ...all.assignments.map((row) => eventDayKey(row.assignmentDate)),
    ...all.requiredRoles.map((row) => eventDayKey(row.day)),
  ].filter((day) => Number.isFinite(dayTimestamp(day))).sort();
  if (relocate && plannedDays.length && (end < plannedDays[0] || start > plannedDays.at(-1))) {
    const anchorDate = retained.anchorDate || retained.startDate;
    const moved = shiftDuplicatedServiceStart({ ...all, date: anchorDate }, start);
    // Moving the planning does not choose or overwrite the user's end date.
    all = { ...moved, endDate: form.endDate };
    const offset = dayTimestamp(start) - dayTimestamp(anchorDate);
    const shift = (day) => new Date(dayTimestamp(day) + offset).toISOString().slice(0, 10);
    mapping = { ...retained, startDate: shift(retained.startDate), endDate: shift(retained.endDate) };
  }
  const active = synchronizeDuplicatedServiceDays(all);
  const activeAssignments = new Set(active.assignments);
  const activeRoles = new Set(active.requiredRoles);
  const nextRetained = {
    ...mapping,
    anchorDate: start > mapping.startDate ? start : mapping.startDate,
    assignments: all.assignments.filter((row) => !activeAssignments.has(row)),
    requiredRoles: all.requiredRoles.filter((row) => !activeRoles.has(row)),
  };
  return {
    form: sameRows(form.assignments, active.assignments) && sameRows(form.requiredRoles, active.requiredRoles) ? form : active,
    retained: nextRetained,
  };
}
