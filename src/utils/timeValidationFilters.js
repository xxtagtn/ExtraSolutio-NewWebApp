export function localDayNumber(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDate();
}

export function dateKeysFrom(keys) {
  if (!keys) return [];
  const values = Array.isArray(keys)
    ? keys
    : typeof keys[Symbol.iterator] === 'function'
      ? [...keys]
      : [];
  return values.filter(Boolean);
}

export { normalizeTimeInput, sanitizeTimeInput } from './timeInput.js';

export function filterRowsBySelectedDays(rows, selectedDays = []) {
  if (!selectedDays.length) return rows || [];
  const selected = new Set(selectedDays.map(Number));
  return (rows || []).filter((row) => selected.has(localDayNumber(effectiveRowDateKey(row))));
}

function localDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function effectiveRowDateKey(row) {
  return localDateKey(row?.workDateKey || row?.assignment?.assignmentDate || row?.event?.date);
}

export function effectiveRowStartTime(row) {
  return row?.assignment?.plannedCheckIn
    || row?.assignment?.checkIn
    || row?.assignment?.clientCheckIn
    || row?.assignment?.validatedCheckIn
    || row?.event?.startTime
    || '';
}

function timeToMinutes(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.POSITIVE_INFINITY;
  return (hours * 60) + minutes;
}

function plannedSortTime(row) {
  return row?.plannedCheckIn || row?.assignment?.plannedCheckIn || row?.event?.startTime || '';
}

export function compareTimeValidationRows(a, b) {
  const byDate = String(effectiveRowDateKey(a) || '').localeCompare(String(effectiveRowDateKey(b) || ''));
  if (byDate) return byDate;

  const byPlannedTime = timeToMinutes(plannedSortTime(a)) - timeToMinutes(plannedSortTime(b));
  if (byPlannedTime) return byPlannedTime;

  const aName = a?.collaboratorName || a?.assignment?.collaborator?.shortName || a?.assignment?.collaborator?.name || '';
  const bName = b?.collaboratorName || b?.assignment?.collaborator?.shortName || b?.assignment?.collaborator?.name || '';
  const byName = String(aName).localeCompare(String(bName), 'pt', { sensitivity: 'base' });
  if (byName) return byName;

  const byEvent = String(a?.event?.name || '').localeCompare(String(b?.event?.name || ''), 'pt');
  if (byEvent) return byEvent;

  return String(a?.id || a?.assignment?.id || '').localeCompare(
    String(b?.id || b?.assignment?.id || ''),
    'pt',
    { numeric: true },
  );
}

export function filterRowsByDateRange(rows, startDate, endDate) {
  const start = startDate || '';
  const end = endDate || '';
  return (rows || []).filter((row) => {
    const rowDate = effectiveRowDateKey(row);
    if (!rowDate) return false;
    if (start && rowDate < start) return false;
    if (end && rowDate > end) return false;
    return true;
  });
}
