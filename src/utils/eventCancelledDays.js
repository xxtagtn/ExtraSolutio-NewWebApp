function safeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function eventDayKey(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return [
      String(value.getUTCFullYear()).padStart(4, '0'),
      String(value.getUTCMonth() + 1).padStart(2, '0'),
      String(value.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }
  if (
    typeof value === 'object'
    && Number.isInteger(Number(value.year))
    && Number.isInteger(Number(value.month))
    && Number.isInteger(Number(value.day))
  ) {
    return [
      String(Number(value.year)).padStart(4, '0'),
      String(Number(value.month)).padStart(2, '0'),
      String(Number(value.day)).padStart(2, '0'),
    ].join('-');
  }
  return String(value).slice(0, 10);
}

function localDateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function eventDayKeys(event = {}) {
  const startKey = eventDayKey(event.date);
  if (!startKey) return [];
  if (!event.isContinuous) return [startKey];

  const endKey = eventDayKey(event.endDate || event.date);
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [startKey];
  }

  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function normalizeCancelledDayEntries(value) {
  const entries = safeJsonArray(value?.cancelledDays ?? value);
  const byDate = new Map();

  for (const item of entries) {
    const date = eventDayKey(typeof item === 'string' ? item : item?.date || item?.day);
    if (!date) continue;
    const assignmentStates = Array.isArray(item?.assignmentStates)
      ? item.assignmentStates
        .map((state) => ({
          id: Number(state?.id),
          status: String(state?.status || ''),
          validationStatus: String(state?.validationStatus || ''),
        }))
        .filter((state) => Number.isInteger(state.id) && state.id > 0)
      : [];
    byDate.set(date, {
      date,
      cancelledAt: typeof item === 'object' ? item?.cancelledAt || null : null,
      assignmentStates,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function cancelledEventDayKeys(event = {}) {
  return new Set(normalizeCancelledDayEntries(event).map((item) => item.date));
}

export function isEventDayCancelled(event = {}, day) {
  const key = eventDayKey(day);
  return Boolean(key && cancelledEventDayKeys(event).has(key));
}

export function assignmentEventDay(assignment = {}, event = {}) {
  return eventDayKey(assignment.assignmentDate || assignment.workDate || assignment.date || event.date);
}

export function representedEventDayKeys(event = {}) {
  const days = new Set(eventDayKeys(event));

  for (const assignment of event.assignments || []) {
    const day = assignmentEventDay(assignment, event);
    if (day) days.add(day);
  }

  for (const role of safeJsonArray(event.requiredRoles)) {
    const day = eventDayKey(role?.day || role?.date || role?.workDate);
    if (day) days.add(day);
  }

  for (const entry of normalizeCancelledDayEntries(event)) {
    if (entry.date) days.add(entry.date);
  }

  return [...days].sort((a, b) => a.localeCompare(b));
}

export function isAssignmentOnCancelledDay(assignment = {}, event = {}) {
  return isEventDayCancelled(event, assignmentEventDay(assignment, event));
}

export function activeEventDayKeys(event = {}) {
  const cancelled = cancelledEventDayKeys(event);
  return eventDayKeys(event).filter((day) => !cancelled.has(day));
}

export function activeEventAssignments(event = {}, assignments = event.assignments || []) {
  return (assignments || []).filter((assignment) => !isAssignmentOnCancelledDay(assignment, event));
}

export function activeEventRequiredRoles(event = {}, roles = event.requiredRoles) {
  const cancelled = cancelledEventDayKeys(event);
  return safeJsonArray(roles).filter((role) => {
    const day = eventDayKey(role?.day || role?.date || role?.workDate);
    return !day || !cancelled.has(day);
  });
}
