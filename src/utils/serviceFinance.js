export function decimalValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const raw = String(value)
    .replace(/€/g, '')
    .replace(/\/\s*h(?:ora)?s?/gi, '')
    .replace(/\b(?:eur|euros?)\b/gi, '')
    .replace(/\s/g, '')
    .trim();
  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(',', '.');
  } else if (dotIndex >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const beforeDot = raw.slice(0, dotIndex);
    const afterDot = raw.slice(dotIndex + 1);
    if (dotCount > 1 || (afterDot.length === 3 && beforeDot.length <= 3)) {
      normalized = raw.replace(/\./g, '');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMinutes(time) {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function roundTimeForBilling(time) {
  const minutes = toMinutes(time);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (minute <= 14) return hour * 60;
  if (minute <= 44) return (hour * 60) + 30;
  return (hour + 1) * 60;
}

function hasCompleteTimePair(start, end) {
  return toMinutes(start) !== null && toMinutes(end) !== null;
}

export function roundedClockTime(time) {
  const rounded = roundTimeForBilling(time);
  if (rounded === null) return '';
  const normalized = rounded % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function roundedBillableHours(start, end) {
  const roundedStart = roundTimeForBilling(start);
  const roundedEnd = roundTimeForBilling(end);
  if (roundedStart === null || roundedEnd === null) return 0;
  let s = roundedStart;
  let e = roundedEnd;
  if (e < s) e += 24 * 60;
  return Number(((e - s) / 60).toFixed(2));
}

export function clientRealHours(assignment) {
  const validated = roundedBillableHours(assignment?.validatedCheckIn, assignment?.validatedCheckOut);
  if (hasCompleteTimePair(assignment?.validatedCheckIn, assignment?.validatedCheckOut)) return validated;

  const clientReported = roundedBillableHours(assignment?.clientCheckIn, assignment?.clientCheckOut);
  if (hasCompleteTimePair(assignment?.clientCheckIn, assignment?.clientCheckOut)) return clientReported;

  const explicit = decimalValue(assignment?.clientRealHours) || 0;
  if (explicit > 0) return explicit;

  const checked = roundedBillableHours(assignment?.checkIn, assignment?.checkOut);
  if (hasCompleteTimePair(assignment?.checkIn, assignment?.checkOut)) return checked;

  return 0;
}

export function clientChargeHours(assignment, fallbackStart = '', fallbackEnd = '', minimumHours = 0) {
  const minimum = Math.max(0, decimalValue(minimumHours) || 0);
  const validated = roundedBillableHours(assignment?.validatedCheckIn, assignment?.validatedCheckOut);
  if (hasCompleteTimePair(assignment?.validatedCheckIn, assignment?.validatedCheckOut)) return Math.max(validated, minimum);

  const clientReported = roundedBillableHours(assignment?.clientCheckIn, assignment?.clientCheckOut);
  if (hasCompleteTimePair(assignment?.clientCheckIn, assignment?.clientCheckOut)) return Math.max(clientReported, minimum);

  const staffReported = roundedBillableHours(assignment?.checkIn, assignment?.checkOut);
  if (hasCompleteTimePair(assignment?.checkIn, assignment?.checkOut)) return Math.max(staffReported, minimum);

  const explicit = decimalValue(assignment?.clientBillableHours) || 0;
  if (explicit > 0) return Math.max(explicit, minimum);

  const planned = roundedBillableHours(assignment?.plannedCheckIn, assignment?.plannedCheckOut);
  if (hasCompleteTimePair(assignment?.plannedCheckIn, assignment?.plannedCheckOut)) return Math.max(planned, minimum);

  const eventPlanned = roundedBillableHours(fallbackStart, fallbackEnd);
  if (hasCompleteTimePair(fallbackStart, fallbackEnd)) return Math.max(eventPlanned, minimum);

  const worked = decimalValue(assignment?.hoursWorked) || 0;
  return worked > 0 ? Math.max(worked, minimum) : 0;
}

export function staffWorkedHours(assignment, fallbackStart = '', fallbackEnd = '') {
  const checked = roundedBillableHours(assignment?.checkIn, assignment?.checkOut);
  if (hasCompleteTimePair(assignment?.checkIn, assignment?.checkOut)) return checked;

  const explicit = decimalValue(assignment?.staffPayableHours) || 0;
  if (explicit > 0) return explicit;

  const worked = decimalValue(assignment?.hoursWorked) || 0;
  if (worked > 0) return worked;

  const planned = roundedBillableHours(assignment?.plannedCheckIn, assignment?.plannedCheckOut);
  if (hasCompleteTimePair(assignment?.plannedCheckIn, assignment?.plannedCheckOut)) return planned;

  const hasClientHours = Boolean(
    assignment?.clientCheckIn
    || assignment?.clientCheckOut
    || assignment?.validatedCheckIn
    || assignment?.validatedCheckOut
  );
  return hasClientHours ? 0 : roundedBillableHours(fallbackStart, fallbackEnd);
}

export function staffPaymentHours(assignment, fallbackStart = '', fallbackEnd = '') {
  const clientHours = clientRealHours(assignment);
  const hasValidatedPair = hasCompleteTimePair(
    assignment?.validatedCheckIn,
    assignment?.validatedCheckOut,
  );
  const hasClientPair = hasCompleteTimePair(
    assignment?.clientCheckIn,
    assignment?.clientCheckOut,
  );
  const hasPersistedClientHours = (decimalValue(assignment?.clientRealHours) || 0) > 0;
  if (hasValidatedPair || hasClientPair || hasPersistedClientHours) return clientHours;

  // Compatibility for legacy records that reached Financeiro before client
  // schedules were stored separately.
  return staffWorkedHours(assignment, fallbackStart, fallbackEnd);
}

export function collaboratorHourlyRate(collaborator) {
  return decimalValue(collaborator?.hourlyRate) || 0;
}

function mapGet(collaboratorsById, id) {
  if (!collaboratorsById || !id) return null;
  if (typeof collaboratorsById.get === 'function') return collaboratorsById.get(String(id));
  return collaboratorsById[String(id)] || collaboratorsById[id] || null;
}

export function assignmentStaffRate(assignment, collaboratorsById, clientRoleRate = 0) {
  const assignedRate = decimalValue(assignment?.hourlyRate);
  const roleRate = decimalValue(clientRoleRate) || 0;
  const collaboratorRate = collaboratorHourlyRate(mapGet(collaboratorsById, assignment?.collaboratorId));

  if (assignment?.manualHourlyRate && assignedRate !== null) return assignedRate;
  if (collaboratorRate > 0 && (!assignedRate || assignedRate === roleRate)) return collaboratorRate;
  return assignedRate || collaboratorRate || 0;
}

export function assignmentStaffCost(assignment, workedHours, collaboratorsById, clientRoleRate = 0) {
  const cost = (Number(workedHours || 0) * assignmentStaffRate(assignment, collaboratorsById, clientRoleRate));
  return Number(cost.toFixed(2));
}
