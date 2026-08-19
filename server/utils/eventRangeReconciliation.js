import {
  assignmentEventDay,
  eventDayKey,
  eventDayKeys,
  normalizeCancelledDayEntries,
} from '../../src/utils/eventCancelledDays.js';

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storedArray(rows) {
  return rows.length ? JSON.stringify(rows) : null;
}

export function reconcileEventRangeData(existing = {}, data = {}) {
  const nextEvent = { ...existing, ...data };
  const activeDays = new Set(eventDayKeys(nextEvent));
  const nextData = { ...data };

  const requiredRoles = jsonArray(data.requiredRoles ?? existing.requiredRoles).filter((role) => {
    const day = eventDayKey(role?.day || role?.date || role?.workDate);
    return !day || activeDays.has(day);
  });
  const drafts = jsonArray(data.assignmentDrafts ?? existing.assignmentDrafts).filter((draft) => {
    const day = eventDayKey(draft?.assignmentDate || draft?.day || draft?.date);
    return !day || activeDays.has(day);
  });
  const cancelledDays = normalizeCancelledDayEntries(data.cancelledDays ?? existing.cancelledDays)
    .filter((entry) => activeDays.has(entry.date));

  nextData.requiredRoles = storedArray(requiredRoles);
  nextData.assignmentDrafts = storedArray(drafts);
  nextData.cancelledDays = storedArray(cancelledDays);

  return { data: nextData, nextEvent, activeDays };
}

export function assignmentsOutsideEventRange(assignments = [], event = {}) {
  const activeDays = new Set(eventDayKeys(event));
  return assignments.filter((assignment) => {
    const day = assignmentEventDay(assignment, event);
    return Boolean(day && !activeDays.has(day));
  });
}

export function partitionAssignmentsOutsideEventRange(assignments = [], event = {}) {
  const outside = assignmentsOutsideEventRange(assignments, event);
  return {
    removable: outside.filter((assignment) => (
      String(assignment?.status || '').trim().toLowerCase() === 'cancelled'
    )),
    blocking: outside.filter((assignment) => (
      String(assignment?.status || '').trim().toLowerCase() !== 'cancelled'
    )),
  };
}
