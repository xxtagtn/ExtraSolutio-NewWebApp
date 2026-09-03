import { invoiceIsIssued } from '../../shared/invoiceLifecycle.js';

const EVENT_FINANCIAL_FIELDS = new Set([
  'clientId',
  'date',
  'endDate',
  'isContinuous',
  'startTime',
  'endTime',
  'requiredRoles',
  'minimumHoursSnapshot',
  'travelExpenseEnabled',
  'travelExpenseAmount',
  'travelType',
  'travelPeople',
  'km',
  'kmRate',
  'durationHours',
  'travelStaffHourlyRate',
  'travelCars',
  'split5050',
  'travelManualAmount',
  'externalCosts',
  'vatRateSnapshot',
]);

const ASSIGNMENT_REVENUE_FIELDS = new Set([
  'eventId',
  'collaboratorId',
  'assignmentDate',
  'role',
  'plannedCheckIn',
  'plannedCheckOut',
  'checkIn',
  'checkOut',
  'clientCheckIn',
  'clientCheckOut',
  'validatedCheckIn',
  'validatedCheckOut',
  'hoursWorked',
  'clientRealHours',
  'clientBillableHours',
  'status',
]);

const LOCKED_BILLING_STATUSES = new Set(['invoiced', 'paid']);
const LOCKED_EVENT_STATUSES = new Set(['invoiced', 'paid']);

function parsedEventIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return String(value).split(',').map(Number).filter(Number.isFinite);
  }
}

export function invoiceEventIds(invoice = {}) {
  const ids = new Set(parsedEventIds(invoice.eventIds));
  const directId = Number(invoice.eventId);
  if (Number.isInteger(directId) && directId > 0) ids.add(directId);
  return [...ids];
}

export function invoiceIsIssuedForEvent(invoice = {}, eventId) {
  return invoiceIsIssued(invoice) && invoiceEventIds(invoice).includes(Number(eventId));
}

export function eventRevenueIsLocked(event = {}) {
  return LOCKED_BILLING_STATUSES.has(String(event.billingStatus || '').trim().toLowerCase())
    || LOCKED_EVENT_STATUSES.has(String(event.status || '').trim().toLowerCase());
}

export function hasEventFinancialImpact(input = {}) {
  return Object.keys(input || {}).some((field) => EVENT_FINANCIAL_FIELDS.has(field));
}

export function hasAssignmentRevenueImpact(input = {}) {
  return Object.keys(input || {}).some((field) => ASSIGNMENT_REVENUE_FIELDS.has(field));
}

export async function issuedInvoiceForEvent(prisma, eventId, knownInvoices = []) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const known = (knownInvoices || []).find((invoice) => invoiceIsIssuedForEvent(invoice, id));
  if (known) return known;

  const candidates = await prisma.invoice.findMany({
    where: {
      OR: [
        { eventId: id },
        { eventIds: { contains: String(id) } },
      ],
    },
    select: {
      id: true,
      number: true,
      eventId: true,
      eventIds: true,
      issueDate: true,
      status: true,
    },
  });
  return candidates.find((invoice) => invoiceIsIssuedForEvent(invoice, id)) || null;
}

export async function assertEventRevenueEditable(prisma, eventId, knownInvoices = [], knownEvent = null) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return;
  const event = knownEvent || await prisma.event.findUnique({
    where: { id },
    select: { id: true, status: true, billingStatus: true },
  });
  if (eventRevenueIsLocked(event)) {
    const error = new Error(
      'Este evento já possui faturação emitida/fechada. A alteração teria impacto financeiro; regista o ajuste manualmente no Financeiro.',
    );
    error.statusCode = 409;
    error.expose = true;
    throw error;
  }
  const invoice = await issuedInvoiceForEvent(prisma, id, knownInvoices);
  if (!invoice) return;
  const reference = invoice.number ? ` (${invoice.number})` : '';
  const error = new Error(
    `Este evento já possui uma fatura emitida${reference}. A alteração teria impacto financeiro; regista o ajuste manualmente no Financeiro.`,
  );
  error.statusCode = 409;
  error.expose = true;
  throw error;
}
