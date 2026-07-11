import { isStaffAcceptedValidationStatus } from './hourValidationStatus.js';
import { requiredStaffTotal } from './serviceRequirements.js';

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

function assignmentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function billableAssignments(assignments = []) {
  return assignments.filter((assignment) => !NON_BILLABLE_ASSIGNMENT_STATUSES.has(assignmentStatus(assignment.status)));
}

export function eventHasCompleteStaffSchedule(event) {
  const assignments = billableAssignments(event?.assignments || []);
  return assignments.length > 0 && assignments.every((assignment) => Boolean(
    assignment.checkIn
    && assignment.checkOut
    && (
      isStaffAcceptedValidationStatus(assignment.validationStatus)
      || assignment.validationStatus === 'validated'
    ),
  ));
}

export function eventHasCompleteClientSchedule(event) {
  const assignments = billableAssignments(event?.assignments || []);
  return assignments.length > 0 && assignments.every((assignment) => (
    assignment.checkIn
    && assignment.checkOut
    && assignment.clientCheckIn
    && assignment.clientCheckOut
  ));
}

function requestedStaffCount(event) {
  return requiredStaffTotal(event);
}

function eventHasCompleteTeam(event) {
  const requested = requestedStaffCount(event);
  if (requested <= 0) return false;
  const confirmed = (event?.assignments || []).filter((assignment) => assignmentStatus(assignment.status) === 'confirmed').length;
  return confirmed >= requested;
}

function eventHasConfirmedAssignedTeam(event) {
  const assignments = billableAssignments(event?.assignments || []);
  return assignments.length > 0 && assignments.every((assignment) => assignmentStatus(assignment.status) === 'confirmed');
}

function eventHasReadyTeam(event) {
  return requestedStaffCount(event) > 0
    ? eventHasCompleteTeam(event)
    : eventHasConfirmedAssignedTeam(event);
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
  const hasReadyTeam = eventHasReadyTeam(event);

  if (current === SERVICE_STATUS.finalized || current === 'cancelled') return current;
  if (current === SERVICE_STATUS.toValidateClient) return current;

  if (current === SERVICE_STATUS.toValidateStaff) {
    if (dateState === 'after' && hasReadyTeam) return current;
    if (dateState === 'current') return SERVICE_STATUS.inProgress;
    if (hasReadyTeam) return SERVICE_STATUS.teamComplete;
    return SERVICE_STATUS.drafting;
  }

  if (dateState === 'after') {
    if (current === SERVICE_STATUS.inProgress || current === SERVICE_STATUS.teamComplete || hasReadyTeam) {
      return SERVICE_STATUS.toValidateStaff;
    }
    return SERVICE_STATUS.drafting;
  }
  if (dateState === 'current') return SERVICE_STATUS.inProgress;
  if (hasReadyTeam) return SERVICE_STATUS.teamComplete;
  return SERVICE_STATUS.drafting;
}

export function serviceStatusForDisplay(event = {}, now = new Date()) {
  if (String(event?.statusMode || '').trim().toLowerCase() === 'manual') {
    return normalizeStatus(event.status);
  }
  return nextAutomaticServiceStatus(event, now);
}

export function nextTimeValidationServiceStatus(event = {}) {
  const current = normalizeStatus(event.status);
  const assignments = billableAssignments(event?.assignments || []);

  if (current === 'cancelled') return current;
  if (current === SERVICE_STATUS.finalized) return current;
  if (eventHasCompleteStaffSchedule(event)) return SERVICE_STATUS.toValidateClient;
  if (current === SERVICE_STATUS.toValidateClient) {
    const legacyClientStageIsStillComplete = assignments.length > 0
      && assignments.every((assignment) => assignment.checkIn && assignment.checkOut)
      && assignments.every((assignment) => assignment.validationStatus !== 'reopened');
    if (legacyClientStageIsStillComplete) return current;
  }
  return SERVICE_STATUS.toValidateStaff;
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
