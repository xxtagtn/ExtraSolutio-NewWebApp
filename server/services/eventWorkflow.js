import {
  nextAutomaticServiceStatus,
  nextTimeValidationServiceStatus,
  SERVICE_STATUS,
} from '../../src/utils/serviceStatus.js';
import {
  eventDayKey,
  isEventDayCancelled,
  normalizeCancelledDayEntries,
  representedEventDayKeys,
} from '../../src/utils/eventCancelledDays.js';
import { isBillableEventAssignment } from '../../src/utils/eventFinancialRules.js';
import { calculateEventTotals } from '../utils/eventTotals.js';
import { acceptedStaffHourCachePatch } from '../../src/utils/assignmentDerivedHours.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { assertPaidStaffTravelUnchanged } from '../utils/staffTravelProtection.js';
import { normalizeStaffTravel, staffTravelHoursConfigured } from '../../src/utils/staffTravel.js';
import { externalServiceCanArchive, externalServiceCompletionBlocker, externalServiceIsSettled, isExternalOnlyService } from '../../src/utils/externalServiceWorkflow.js';
import { invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';
import {
  eventRevenueIsLocked,
  invoiceEventIds,
  issuedInvoiceForEvent,
} from '../utils/eventInvoiceProtection.js';

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
  if (externalServiceCanArchive(event, now, process.env.APP_TIMEZONE || 'Europe/Lisbon')) return SERVICE_STATUS.finalized;
  if (isEventWorkflowManual(event)) return status || SERVICE_STATUS.drafting;
  if (status === SERVICE_STATUS.finalized || status === 'cancelled') return status;
  if (isExternalOnlyService(event)) return nextAutomaticServiceStatus({ ...event, status }, now);

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

async function withTransaction(prisma, callback, options) {
  if (typeof prisma.$transaction === 'function') return prisma.$transaction(callback, options);
  return callback(prisma);
}

async function loadEvent(client, id) {
  const event = await client.event.findUnique({
    where: { id },
    include: {
      client: true,
      assignments: { include: { collaborator: true } },
      invoices: true,
    },
  });
  if (event && isExternalOnlyService(event) && client.invoice?.findMany) {
    const linked = await client.invoice.findMany({
      where: { OR: [{ eventId: id }, { eventIds: { contains: String(id) } }] },
      select: { id: true, eventId: true, eventIds: true, status: true, issueDate: true },
    });
    const invoices = new Map((event.invoices || []).map((invoice) => [invoice.id, invoice]));
    for (const invoice of linked) if (invoiceEventIds(invoice).includes(id) && !invoices.has(invoice.id)) invoices.set(invoice.id, invoice);
    event.invoices = [...invoices.values()];
  }
  return event;
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
    const externalOnly = isExternalOnlyService(event);
    const issued = externalOnly ? (event.invoices || []).filter(invoiceIsIssued) : [];
    if (issued.length) {
      const billingStatus = issued.every(invoiceIsPaid) ? 'paid' : 'invoiced';
      if (event.billingStatus !== billingStatus) {
        data.billingStatus = billingStatus;
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: process.env.APP_TIMEZONE || 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
        data.billingPaymentDate = billingStatus === 'paid' ? event.billingPaymentDate || new Date(`${eventDayKey(parts)}T00:00:00Z`) : null;
      }
    }
    const nextStatus = deriveEventWorkflowStatus({ ...event, ...data }, now);
    if (nextStatus && nextStatus !== event.status) data.status = nextStatus;

    if (recalculateTotals) {
      const issuedInvoice = await issuedInvoiceForEvent(client, id, event.invoices);
      const preserveClientTotals = eventRevenueIsLocked(event) || Boolean(issuedInvoice);
      if (!preserveClientTotals) {
        for (const assignment of event.assignments) {
          const patch = acceptedStaffHourCachePatch(assignment, event);
          if (Object.keys(patch).length) {
            await client.eventAssignment.update({ where: { id: assignment.id }, data: patch });
            Object.assign(assignment, patch);
          }
        }
      }
      Object.assign(data, calculateEventTotals(event, event.assignments, {
        preserveClientTotals,
      }));
      if (!preserveClientTotals) Object.assign(data, clientPaymentRecordPatch(event, data));
    }

    let result = event;
    if (Object.keys(data).length) {
      if (externalOnly) {
        const changed = await client.event.updateMany({
          where: { id, updatedAt: event.updatedAt, status: event.status, assignments: { none: {} } }, data,
        });
        if (changed.count !== 1) throw publicWorkflowError(409, 'O evento foi alterado. Atualiza a página e confirma novamente.');
        result = await loadEvent(client, id);
      } else result = await client.event.update({ where: { id }, data, include: { assignments: true } });
    }
    return externalOnly ? { ...result, externalService: { only: true, settled: externalServiceIsSettled({ ...event, ...data }),
      settledByInvoice: issued.length > 0 && issued.every(invoiceIsPaid) } } : result;
  });
}

export async function externalServiceForRead(prisma, row) {
  if (!isExternalOnlyService(row)) return row;
  const synced = await synchronizeEventWorkflow(prisma, row.id);
  return { ...row, status: synced.status, statusMode: synced.statusMode, billingStatus: synced.billingStatus,
    billingPaymentDate: synced.billingPaymentDate, updatedAt: synced.updatedAt, externalService: synced.externalService };
}

export async function synchronizeExternalInvoiceEvents(client, invoice) {
  for (const id of invoiceEventIds(invoice)) {
    const event = await loadEvent(client, id);
    if (!event || !isExternalOnlyService(event)) continue;
    if (['cancelled', 'void'].includes(String(invoice.status || '').toLowerCase())
      && !(event.invoices || []).some(invoiceIsIssued)) {
      const changed = await client.event.updateMany({
        where: { id, updatedAt: event.updatedAt, status: event.status, assignments: { none: {} } },
        data: { billingStatus: 'pending', billingPaymentDate: null },
      });
      if (changed.count !== 1) throw publicWorkflowError(409, 'O evento foi alterado. Atualiza a página e confirma novamente.');
    }
    await synchronizeEventWorkflow(client, id);
  }
}

export async function persistInvoiceWithExternalWorkflow(prisma, { id, data, include, existing }) {
  return withTransaction(prisma, async (client) => {
    const invoice = id ? await client.invoice.update({ where: { id }, data, include })
      : await client.invoice.create({ data, include });
    await synchronizeExternalInvoiceEvents(client, invoice);
    if (existing) await synchronizeExternalInvoiceEvents(client, existing);
    return client.invoice.findUnique({ where: { id: invoice.id }, include });
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
    for (const assignment of event.assignments) {
      assertPaidStaffTravelUnchanged(assignment, assignment, event, { ...event, ...data });
    }
    if (staffTravelHoursConfigured(event) || normalizeStaffTravel(event.travelCars).length) {
      data.totalCost = calculateEventTotals({ ...event, ...data }, event.assignments).totalCost;
    }
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

export async function completeExternalService(prisma, eventId, { now = new Date() } = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    return await withTransaction(prisma, async (client) => {
      const event = await loadEvent(client, id);
      if (!event) return null;
      const blocker = externalServiceCompletionBlocker(event, now, process.env.APP_TIMEZONE || 'Europe/Lisbon');
      if (blocker) throw publicWorkflowError(409, blocker);
      if (normalizedStatus(event.status) === SERVICE_STATUS.finalized) return event;
      // Only operational fields change; invoiced/paid amounts must remain byte-for-byte intact.
      const changed = await client.event.updateMany({
        where: { id, updatedAt: event.updatedAt, status: event.status, assignments: { none: {} } },
        data: { status: SERVICE_STATUS.finalized, statusMode: EVENT_WORKFLOW_MODE.manual },
      });
      if (changed.count !== 1) throw publicWorkflowError(409, 'O evento foi alterado. Atualiza a página e confirma novamente.');
      return loadEvent(client, id);
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw publicWorkflowError(409, 'O evento foi alterado. Atualiza a página e confirma novamente.');
    throw error;
  }
}

export async function reopenEventValidation(prisma, eventId, notes, { assignmentIds } = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;

  let selectedIds = null;
  if (assignmentIds !== undefined) {
    if (!Array.isArray(assignmentIds) || assignmentIds.some((value) => !Number.isInteger(Number(value)) || Number(value) <= 0)) {
      throw publicWorkflowError(400, 'Seleciona registos válidos para reabrir a validação.');
    }
    selectedIds = new Set(assignmentIds.map(Number));
    if (selectedIds.size !== assignmentIds.length) {
      throw publicWorkflowError(400, 'O mesmo registo não pode ser reaberto mais do que uma vez no mesmo pedido.');
    }
  }

  return withTransaction(prisma, async (client) => {
    const event = await client.event.findUnique({
      where: { id },
      include: { assignments: { include: { collaborator: { select: { includeVat: true } } } } },
    });
    if (!event) return null;
    const selected = (event.assignments || []).filter((assignment) => selectedIds?.has(assignment.id));
    if (selectedIds && selected.length !== selectedIds.size) {
      throw publicWorkflowError(404, 'Um ou mais registos já não existem ou não pertencem a este evento. Atualiza a página.');
    }
    if (selected.some((assignment) => (
      !isBillableEventAssignment(assignment)
      || event.status === 'cancelled'
      || isEventDayCancelled(event, assignmentDay(assignment, event))
    ))) {
      throw publicWorkflowError(409, 'Não é possível reabrir validações de faltas ou de serviços/dias cancelados. Atualiza a página.');
    }

    const validationData = {
      validatedCheckIn: null,
      validatedCheckOut: null,
      validationStatus: 'reopened',
    };
    if (selected.length) {
      // Reopen the selection and the event atomically, without per-row recalculations.
      await client.eventAssignment.updateMany({
        where: { eventId: id, id: { in: [...selectedIds] } },
        data: validationData,
      });
    }
    const nextAssignments = (event.assignments || []).map((assignment) => (
      selectedIds?.has(assignment.id) ? { ...assignment, ...validationData } : assignment
    ));
    return client.event.update({
      where: { id },
      data: {
        ...(selected.length ? calculateEventTotals(event, nextAssignments) : {}),
        status: SERVICE_STATUS.toValidateStaff,
        statusMode: EVENT_WORKFLOW_MODE.automatic,
        notes: withoutValidatedHoursMarker(notes ?? event.notes) || null,
      },
      include: { assignments: true },
    });
  });
}
