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

export function validationWorkLocationLabel(event = {}, assignment = {}) {
  if (!event?.workLocationsEnabled) return '';
  return String(assignment?.workLocation?.name || '').trim();
}

function normalizedFilterValue(value) {
  return String(value).trim().toLocaleLowerCase('pt-PT');
}

function normalizedNif(value) {
  return String(value).replace(/\s+/g, '').trim().toLocaleLowerCase('pt-PT');
}

function relatedPeople(record = {}) {
  return [
    record.collaborator,
    record.staff,
    record.employee,
    record.colaborador,
  ].filter(Boolean);
}

/**
 * Normalizes the collaborator relation before building filter keys.
 *
 * Validation rows can be assembled from different API payloads. Keeping the
 * fallback name/NIF on the same object used by the filter prevents the select
 * from being built with one identity while the table is filtered with another.
 */
export function validationCollaboratorFilterIdentity(assignment = {}) {
  const people = relatedPeople(assignment);
  const person = people[0] || {};
  const collaborator = assignment.collaborator || person;
  const collaboratorName = assignment.collaboratorName
    || assignment.staffName
    || assignment.employeeName
    || person.shortName
    || person.name
    || person.fullName
    || '';
  const nif = assignment.nif
    || assignment.staffNif
    || assignment.employeeNif
    || assignment.collaboratorNif
    || person.nif
    || person.taxNumber
    || '';

  return {
    ...assignment,
    collaborator,
    collaboratorName,
    nif,
  };
}

/** Normalizes client relation/name fallbacks used by validation filters. */
export function validationClientFilterIdentity(event = {}) {
  const client = event.client || event.customer || event.cliente || {};
  const clientName = event.clientName
    || event.customerName
    || event.clienteName
    || client.name
    || client.shortName
    || '';

  return {
    ...event,
    client: event.client || client,
    clientName,
  };
}

/**
 * Returns the stable key used by the validation client filter.
 *
 * Some API responses expose the relation id as `clientId`, while others only
 * include the nested client object. Manual-client events may have no id at
 * all, so their normalized name is used as a fallback instead of silently
 * making the filter match every row with an empty key.
 */
export function validationClientFilterKeys(event = {}) {
  const clients = [event.client, event.customer, event.cliente].filter(Boolean);
  const keys = [];
  const addId = (value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      keys.push(`id:${String(value).trim()}`);
    }
  };
  const addName = (value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      keys.push(`name:${normalizedFilterValue(value)}`);
    }
  };

  [
    event.clientId,
    event.customerId,
    event.clienteId,
    ...clients.flatMap((client) => [client.id, client.clientId, client.customerId]),
  ].forEach(addId);
  [event.clientName, event.customerName, event.clienteName, ...clients.flatMap((client) => [client.name, client.shortName])]
    .forEach(addName);

  return [...new Set(keys)];
}

export function validationClientFilterKey(event = {}) {
  return validationClientFilterKeys(event)[0] || 'unassigned';
}

/**
 * Checks a client filter against the canonical identity of the event.
 *
 * Older API responses can expose stale nested relation data alongside the
 * direct `clientId`. The direct identity must win, otherwise a row can match
 * a client that is only present in an unrelated nested field.
 */
export function matchesValidationClientFilter(event = {}, selectedId = 'all') {
  if (selectedId === 'all') return true;
  const selected = String(selectedId).trim();
  const keys = validationClientFilterKeys(event);
  const canonical = keys[0];
  if (canonical) {
    return canonical === selected
      || (canonical.startsWith('id:') && canonical.slice(3) === selected);
  }
  return keys.some((key) => (
    key === selected
    || (key.startsWith('id:') && key.slice(3) === selected)
  ));
}

/** Returns every key exposed for a collaborator by the different API shapes. */
export function validationCollaboratorFilterKeys(assignment = {}) {
  const people = relatedPeople(assignment);
  const keys = [];
  const addId = (value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      keys.push(`id:${String(value).trim()}`);
    }
  };
  const addName = (value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      keys.push(`name:${normalizedFilterValue(value)}`);
    }
  };
  const addNif = (value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      keys.push(`nif:${normalizedNif(value)}`);
    }
  };

  [
    assignment.collaboratorId,
    assignment.staffId,
    assignment.employeeId,
    assignment.collaborator_id,
    assignment.employee_id,
    ...people.flatMap((person) => [
      person.id,
      person.collaboratorId,
      person.staffId,
      person.employeeId,
    ]),
  ].forEach(addId);
  [
    assignment.collaboratorName,
    assignment.staffName,
    assignment.employeeName,
    ...people.flatMap((person) => [person.shortName, person.name, person.fullName]),
  ].forEach(addName);
  [
    assignment.nif,
    assignment.staffNif,
    assignment.employeeNif,
    ...people.flatMap((person) => [person.nif, person.taxNumber]),
  ].forEach(addNif);

  const uniqueKeys = [...new Set(keys)];
  // Prefer a stable collaborator ID when the API provides one. NIF and name
  // remain fallbacks because imports and older records may omit the ID.
  return [
    ...uniqueKeys.filter((key) => key.startsWith('id:')),
    ...uniqueKeys.filter((key) => key.startsWith('nif:')),
    ...uniqueKeys.filter((key) => key.startsWith('name:')),
  ];
}

/** Returns the canonical option key used by the validation collaborator filter. */
export function validationCollaboratorFilterKey(assignment = {}) {
  return validationCollaboratorFilterKeys(assignment)[0] || '';
}

function normalizedCollaboratorSelection(value) {
  const selected = String(value ?? '').trim();
  if (!selected || selected === 'all') return selected || 'all';
  if (/^(?:id|nif|name):/i.test(selected)) return selected;
  return /^\d+$/.test(selected) ? `id:${selected}` : selected;
}

/**
 * Checks a collaborator filter without relying on the current view tab.
 *
 * The direct collaborator/staff/employee ID is authoritative. We only use
 * the remaining keys when no canonical identity is available, which keeps
 * legacy/imported rows filterable without allowing stale nested relations to
 * make another collaborator appear in the result.
 */
export function matchesValidationCollaboratorFilter(assignment = {}, selectedId = 'all') {
  const selected = normalizedCollaboratorSelection(selectedId);
  if (selected === 'all') return true;
  return validationCollaboratorFilterKey(assignment) === selected;
}

/** Filters complete validation row collections by one canonical collaborator key. */
export function filterValidationRowsByCollaborator(rows = [], selectedId = 'all') {
  const selected = normalizedCollaboratorSelection(selectedId);
  if (selected === 'all') return rows;

  return rows.filter((row) => {
    const key = row?.collaboratorFilterKey
      || validationCollaboratorFilterKey(
        row?.collaboratorFilterIdentity || row?.assignment || row,
      );
    return key === selected;
  });
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

  const aName = a?.collaboratorName || a?.assignment?.collaborator?.shortName || a?.assignment?.collaborator?.name || '';
  const bName = b?.collaboratorName || b?.assignment?.collaborator?.shortName || b?.assignment?.collaborator?.name || '';
  const byName = String(aName).localeCompare(String(bName), 'pt', { sensitivity: 'base' });
  if (byName) return byName;

  const byPlannedTime = timeToMinutes(plannedSortTime(a)) - timeToMinutes(plannedSortTime(b));
  if (byPlannedTime) return byPlannedTime;

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
