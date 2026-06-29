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
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
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
  if (validated > 0) return validated;

  const clientReported = roundedBillableHours(assignment?.clientCheckIn, assignment?.clientCheckOut);
  if (clientReported > 0) return clientReported;

  const explicit = decimalValue(assignment?.clientRealHours) || 0;
  if (explicit > 0) return explicit;

  const checked = roundedBillableHours(assignment?.checkIn, assignment?.checkOut);
  if (checked > 0) return checked;

  return 0;
}

export function clientChargeHours(assignment, fallbackStart = '', fallbackEnd = '', minimumHours = 0) {
  const minimum = Math.max(0, decimalValue(minimumHours) || 0);
  const validated = roundedBillableHours(assignment?.validatedCheckIn, assignment?.validatedCheckOut);
  if (validated > 0) return Math.max(validated, minimum);

  const clientReported = roundedBillableHours(assignment?.clientCheckIn, assignment?.clientCheckOut);
  if (clientReported > 0) return Math.max(clientReported, minimum);

  const checked = roundedBillableHours(assignment?.checkIn || fallbackStart, assignment?.checkOut || fallbackEnd);
  if (assignment?.timesTouched && checked > 0) return Math.max(checked, minimum);

  const explicit = decimalValue(assignment?.clientBillableHours) || 0;
  if (explicit > 0) return Math.max(explicit, minimum);

  if (checked > 0) return Math.max(checked, minimum);
  const worked = decimalValue(assignment?.hoursWorked) || 0;
  return worked > 0 ? Math.max(worked, minimum) : 0;
}

export function staffWorkedHours(assignment, fallbackStart = '', fallbackEnd = '') {
  const checked = roundedBillableHours(assignment?.checkIn, assignment?.checkOut);
  if (checked > 0) return checked;

  const validated = roundedBillableHours(assignment?.validatedCheckIn, assignment?.validatedCheckOut);
  if (validated > 0) return validated;

  const explicit = decimalValue(assignment?.staffPayableHours) || 0;
  if (explicit > 0) return explicit;

  const worked = decimalValue(assignment?.hoursWorked) || 0;
  if (worked > 0) return worked;

  return roundedBillableHours(assignment?.checkIn || fallbackStart, assignment?.checkOut || fallbackEnd);
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
