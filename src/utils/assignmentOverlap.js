export const ASSIGNMENT_OVERLAP_MESSAGE = 'Este colaborador já está alocado neste dia num horário que se sobrepõe.';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateStartValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = Date.UTC(year, month - 1, day);
  const parsed = new Date(result);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

function timeMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function comparableDate(value) {
  const dateValue = dateStartValue(value);
  return dateValue === null ? '' : String(dateValue);
}

function comparableValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

export function assignmentScheduleChanged(current = {}, original = {}) {
  return Number(current.collaboratorId || 0) !== Number(original.collaboratorId || 0)
    || comparableDate(current.assignmentDate) !== comparableDate(original.assignmentDate)
    || comparableValue(current.plannedCheckIn) !== comparableValue(original.plannedCheckIn)
    || comparableValue(current.plannedCheckOut) !== comparableValue(original.plannedCheckOut)
    || comparableValue(current.checkIn) !== comparableValue(original.checkIn)
    || comparableValue(current.checkOut) !== comparableValue(original.checkOut);
}

function normalizedEntry(entry) {
  const assignment = entry?.assignment || entry || {};
  const event = entry?.event || assignment.event || {};
  const date = assignment.assignmentDate || event.date;
  const start = assignment.plannedCheckIn || assignment.checkIn || event.startTime;
  const end = assignment.plannedCheckOut || assignment.checkOut || event.endTime;
  const dayStart = dateStartValue(date);
  const startMinutes = timeMinutes(start);
  const endMinutes = timeMinutes(end);
  if (dayStart === null || startMinutes === null || endMinutes === null) return null;

  const startValue = dayStart + (startMinutes * 60 * 1000);
  let endValue = dayStart + (endMinutes * 60 * 1000);
  if (endValue <= startValue) endValue += DAY_MS;

  return {
    assignment,
    event,
    collaboratorId: Number(assignment.collaboratorId),
    startValue,
    endValue,
  };
}

export function findOverlappingAssignment(candidateEntry, existingEntries = []) {
  const candidate = normalizedEntry(candidateEntry);
  if (!candidate || !candidate.collaboratorId) return null;

  for (const entry of existingEntries) {
    const existing = normalizedEntry(entry);
    if (!existing || existing.collaboratorId !== candidate.collaboratorId) continue;
    if (
      candidate.assignment.id
      && existing.assignment.id
      && String(candidate.assignment.id) === String(existing.assignment.id)
    ) {
      continue;
    }

    if (
      candidate.startValue < existing.endValue
      && candidate.endValue > existing.startValue
    ) {
      return entry;
    }
  }

  return null;
}
