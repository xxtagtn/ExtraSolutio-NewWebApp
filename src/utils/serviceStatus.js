const NON_BILLABLE_ASSIGNMENT_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const RETIRED_FINAL_STATUSES = new Set(['completed', 'invoiced', 'paid']);

export const SERVICE_STATUS = {
  drafting: 'drafting',
  teamComplete: 'team_complete',
  inProgress: 'in_progress',
  toValidateStaff: 'to_validate_staff',
  toValidateClient: 'to_validate_client',
  finalized: 'finalized',
};

export const operationalStatusOptions = [
  { value: SERVICE_STATUS.drafting, label: 'A preencher' },
  { value: SERVICE_STATUS.teamComplete, label: 'Equipa completa' },
  { value: SERVICE_STATUS.inProgress, label: 'Em execução' },
  { value: SERVICE_STATUS.toValidateStaff, label: 'Por validar horários (Staff)' },
  { value: SERVICE_STATUS.toValidateClient, label: 'Validação de horários (Cliente)' },
  { value: SERVICE_STATUS.finalized, label: 'Finalizado' },
];

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (RETIRED_FINAL_STATUSES.has(status)) return SERVICE_STATUS.finalized;
  return status || SERVICE_STATUS.drafting;
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = dateOnly(value);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventEndDate(event) {
  return event?.isContinuous && event?.endDate ? event.endDate : event?.date;
}

function safeRequiredRoles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assignmentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function billableAssignments(assignments = []) {
  return assignments.filter((assignment) => !NON_BILLABLE_ASSIGNMENT_STATUSES.has(assignmentStatus(assignment.status)));
}

export function eventHasCompleteStaffSchedule(event) {
  const assignments = billableAssignments(event?.assignments || []);
  return assignments.length > 0 && assignments.every((assignment) => Boolean(assignment.checkIn && assignment.checkOut));
}

function eventHasCompleteTeam(event) {
  const requested = safeRequiredRoles(event?.requiredRoles).reduce((sum, item) => sum + Number(item.qty || 0), 0);
  if (requested <= 0) return false;
  const confirmed = (event?.assignments || []).filter((assignment) => assignmentStatus(assignment.status) === 'confirmed').length;
  return confirmed >= requested;
}

function serviceDateState(event, now = new Date()) {
  const start = parseDateOnly(event?.date);
  const end = parseDateOnly(eventEndDate(event));
  const reference = parseDateOnly(now);
  if (!start || !end || !reference) return 'unknown';
  if (reference > end) return 'after';
  if (reference >= start) return 'current';
  return 'future';
}

export function nextAutomaticServiceStatus(event = {}, now = new Date()) {
  const current = normalizeStatus(event.status);
  const dateState = serviceDateState(event, now);

  if (current === SERVICE_STATUS.finalized || current === 'cancelled') return current;
  if ((current === SERVICE_STATUS.toValidateStaff || dateState === 'after') && eventHasCompleteStaffSchedule(event)) {
    return SERVICE_STATUS.toValidateClient;
  }
  if (current === SERVICE_STATUS.toValidateClient) return current;

  if (dateState === 'after') return SERVICE_STATUS.toValidateStaff;
  if (current === SERVICE_STATUS.toValidateStaff) return current;
  if (dateState === 'current') return SERVICE_STATUS.inProgress;
  if (eventHasCompleteTeam(event)) return SERVICE_STATUS.teamComplete;
  return SERVICE_STATUS.drafting;
}

export function isArchivedService(event = {}) {
  return normalizeStatus(event.status) === SERVICE_STATUS.finalized;
}

export function statusLabel(status) {
  const normalized = normalizeStatus(status);
  const option = operationalStatusOptions.find((item) => item.value === normalized);
  if (option) return option.label;
  if (normalized === 'partial') return 'Parcialmente preenchido';
  if (normalized === 'pending') return 'Pendente';
  if (normalized === 'confirmed') return 'Confirmado';
  if (normalized === 'ongoing') return 'Em curso';
  if (normalized === 'to_validate') return 'Por validar';
  if (normalized === 'cancelled') return 'Cancelado';
  return normalized || '-';
}
