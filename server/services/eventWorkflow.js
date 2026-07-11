import {
  nextAutomaticServiceStatus,
  nextTimeValidationServiceStatus,
  SERVICE_STATUS,
} from '../../src/utils/serviceStatus.js';
import { calculateEventTotals } from '../utils/eventTotals.js';

export const EVENT_WORKFLOW_MODE = Object.freeze({
  automatic: 'automatic',
  manual: 'manual',
});

export const EVENT_VALIDATED_HOURS_MARKER = '[EVENT_VALIDATED_HOURS]';

const VALIDATED_STATUSES = new Set(['completed', 'invoiced', 'paid']);

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALIDATED_STATUSES.has(status) ? SERVICE_STATUS.finalized : status;
}

function normalizeMode(value) {
  return value === EVENT_WORKFLOW_MODE.manual
    ? EVENT_WORKFLOW_MODE.manual
    : EVENT_WORKFLOW_MODE.automatic;
}

export function isEventWorkflowManual(event = {}) {
  return normalizeMode(event.statusMode) === EVENT_WORKFLOW_MODE.manual;
}

export function deriveEventWorkflowStatus(event = {}, now = new Date()) {
  const status = normalizedStatus(event.status);
  if (isEventWorkflowManual(event)) return status || SERVICE_STATUS.drafting;
  if (status === SERVICE_STATUS.finalized || status === 'cancelled') return status;

  const validationStage = new Set([
    SERVICE_STATUS.toValidateStaff,
    SERVICE_STATUS.toValidateClient,
  ]);
  return validationStage.has(status)
    ? nextTimeValidationServiceStatus({ ...event, status })
    : nextAutomaticServiceStatus({ ...event, status }, now);
}

function withoutValidatedHoursMarker(notes) {
  return String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !line.includes(EVENT_VALIDATED_HOURS_MARKER))
    .join('\n')
    .trim();
}

function appendValidatedHoursMarker(notes) {
  const current = String(notes || '').trim();
  if (current.includes(EVENT_VALIDATED_HOURS_MARKER)) return current;
  return [current, `${EVENT_VALIDATED_HOURS_MARKER} ${new Date().toISOString()}`]
    .filter(Boolean)
    .join('\n');
}

async function withTransaction(prisma, callback) {
  if (typeof prisma.$transaction === 'function') return prisma.$transaction(callback);
  return callback(prisma);
}

async function loadEvent(client, id) {
  return client.event.findUnique({
    where: { id },
    include: { assignments: true },
  });
}

export async function synchronizeEventWorkflow(prisma, eventId, {
  recalculateTotals = false,
  now = new Date(),
} = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;

    const data = {};
    const nextStatus = deriveEventWorkflowStatus(event, now);
    if (nextStatus && nextStatus !== event.status) data.status = nextStatus;

    if (recalculateTotals) {
      Object.assign(data, calculateEventTotals(event, event.assignments));
    }

    if (!Object.keys(data).length) return event;
    return client.event.update({ where: { id }, data, include: { assignments: true } });
  });
}

export async function setManualEventStatus(prisma, eventId, status, {
  notes,
} = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const nextStatus = normalizedStatus(status) || SERVICE_STATUS.drafting;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;
    const data = {
      status: nextStatus,
      statusMode: EVENT_WORKFLOW_MODE.manual,
    };
    if (notes !== undefined) data.notes = notes;
    return client.event.update({ where: { id }, data, include: { assignments: true } });
  });
}

export async function markEventValidated(prisma, eventId, notes) {
  return setManualEventStatus(prisma, eventId, SERVICE_STATUS.finalized, {
    notes: appendValidatedHoursMarker(notes),
  });
}

export async function reopenEventValidation(prisma, eventId, notes) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;
    return client.event.update({
      where: { id },
      data: {
        status: SERVICE_STATUS.toValidateStaff,
        statusMode: EVENT_WORKFLOW_MODE.automatic,
        notes: withoutValidatedHoursMarker(notes ?? event.notes) || null,
      },
      include: { assignments: true },
    });
  });
}
