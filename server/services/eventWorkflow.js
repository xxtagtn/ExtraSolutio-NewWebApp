import {
  nextAutomaticServiceStatus,
  nextTimeValidationServiceStatus,
  SERVICE_STATUS,
} from '../../src/utils/serviceStatus.js';
import {
  eventDayKey,
  normalizeCancelledDayEntries,
  representedEventDayKeys,
} from '../../src/utils/eventCancelledDays.js';
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
    include: {
      assignments: { include: { collaborator: true } },
      invoices: true,
    },
  });
}

function publicWorkflowError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function assignmentDay(assignment, event) {
  return eventDayKey(assignment?.assignmentDate || event?.date);
}

function ensureContinuousEventDay(event, day) {
  const date = eventDayKey(day);
  if (!event?.isContinuous) {
    throw publicWorkflowError(422, 'Esta ação está disponível apenas em eventos contínuos.');
  }
  if (!date || !representedEventDayKeys(event).includes(date)) {
    throw publicWorkflowError(422, 'O dia selecionado não pertence a este evento.');
  }
  return date;
}

function isCompletedInvoice(invoice = {}) {
  return !['cancelled', 'canceled', 'void', 'annulled'].includes(
    String(invoice.status || '').trim().toLowerCase(),
  );
}

function hasRecordedAdvance(value) {
  if (!value) return false;
  try {
    const rows = Array.isArray(value) ? value : JSON.parse(value);
    return Array.isArray(rows) && rows.some((row) => Number(row?.amount || 0) !== 0);
  } catch {
    return false;
  }
}

function cancellationBlocker(event, assignments) {
  if (assignments.some((assignment) => (
    String(assignment.validationStatus || '').trim().toLowerCase() === 'validated'
  ))) {
    return 'Este dia já possui horários validados. Reabre primeiro as validações necessárias.';
  }
  if (assignments.some((assignment) => (
    assignment.paymentDate
    || !['', 'unpaid', 'pending'].includes(
      String(assignment.paymentStatus || '').trim().toLowerCase(),
    )
    || assignment.paymentDeferredMonth
    || Number(assignment.paymentAdjustment || 0) !== 0
    || hasRecordedAdvance(assignment.advancePayments)
  ))) {
    return 'Este dia já possui movimentos financeiros de Staff e não pode ser cancelado.';
  }
  if ((event.invoices || []).some(isCompletedInvoice)) {
    return 'Este evento já possui faturação iniciada. Anula ou corrige primeiro a faturação.';
  }
  return '';
}

function eventWithAssignments(event, assignments, overrides = {}) {
  return {
    ...event,
    ...overrides,
    assignments,
  };
}

export async function cancelEventDay(prisma, eventId, day) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;
    const date = ensureContinuousEventDay(event, day);
    const entries = normalizeCancelledDayEntries(event);
    if (entries.some((entry) => entry.date === date)) return event;

    const dayAssignments = event.assignments.filter(
      (assignment) => assignmentDay(assignment, event) === date,
    );
    const blocker = cancellationBlocker(event, dayAssignments);
    if (blocker) throw publicWorkflowError(409, blocker);

    const assignmentStates = dayAssignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      validationStatus: assignment.validationStatus,
    }));
    const cancelledDays = [
      ...entries,
      {
        date,
        cancelledAt: new Date().toISOString(),
        assignmentStates,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    if (dayAssignments.length) {
      await client.eventAssignment.updateMany({
        where: { id: { in: dayAssignments.map((assignment) => assignment.id) } },
        data: { status: 'cancelled' },
      });
    }

    const nextAssignments = event.assignments.map((assignment) => (
      assignmentDay(assignment, event) === date
        ? { ...assignment, status: 'cancelled' }
        : assignment
    ));
    const nextEvent = eventWithAssignments(event, nextAssignments, {
      cancelledDays: JSON.stringify(cancelledDays),
      statusMode: EVENT_WORKFLOW_MODE.automatic,
    });
    const status = deriveEventWorkflowStatus(nextEvent);

    await client.event.update({
      where: { id },
      data: {
        ...calculateEventTotals(nextEvent, nextAssignments),
        cancelledDays: nextEvent.cancelledDays,
        status,
        statusMode: EVENT_WORKFLOW_MODE.automatic,
      },
    });
    return loadEvent(client, id);
  });
}

export async function reactivateEventDay(prisma, eventId, day) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;
    const date = ensureContinuousEventDay(event, day);
    const entries = normalizeCancelledDayEntries(event);
    const cancelledEntry = entries.find((entry) => entry.date === date);
    if (!cancelledEntry) return event;

    const statesById = new Map(
      cancelledEntry.assignmentStates.map((state) => [Number(state.id), state]),
    );
    const dayAssignments = event.assignments.filter(
      (assignment) => assignmentDay(assignment, event) === date,
    );

    for (const assignment of dayAssignments) {
      const previous = statesById.get(Number(assignment.id));
      await client.eventAssignment.update({
        where: { id: assignment.id },
        data: {
          status: previous?.status || 'pending_confirmation',
          ...(previous?.validationStatus
            ? { validationStatus: previous.validationStatus }
            : {}),
        },
      });
    }

    const cancelledDays = entries.filter((entry) => entry.date !== date);
    const nextAssignments = event.assignments.map((assignment) => {
      if (assignmentDay(assignment, event) !== date) return assignment;
      const previous = statesById.get(Number(assignment.id));
      return {
        ...assignment,
        status: previous?.status || 'pending_confirmation',
        validationStatus: previous?.validationStatus || assignment.validationStatus,
      };
    });
    const nextEvent = eventWithAssignments(event, nextAssignments, {
      cancelledDays: cancelledDays.length ? JSON.stringify(cancelledDays) : null,
      status: SERVICE_STATUS.drafting,
      statusMode: EVENT_WORKFLOW_MODE.automatic,
    });
    const status = deriveEventWorkflowStatus(nextEvent);

    await client.event.update({
      where: { id },
      data: {
        ...calculateEventTotals(nextEvent, nextAssignments),
        cancelledDays: nextEvent.cancelledDays,
        status,
        statusMode: EVENT_WORKFLOW_MODE.automatic,
      },
    });
    return loadEvent(client, id);
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
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return withTransaction(prisma, async (client) => {
    const event = await loadEvent(client, id);
    if (!event) return null;
    return client.event.update({
      where: { id },
      data: {
        ...calculateEventTotals(event, event.assignments),
        status: SERVICE_STATUS.finalized,
        statusMode: EVENT_WORKFLOW_MODE.manual,
        notes: appendValidatedHoursMarker(notes),
      },
      include: { assignments: true },
    });
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
