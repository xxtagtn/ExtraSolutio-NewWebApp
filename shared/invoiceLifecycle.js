import { billingDayKey, billingDueDate, billingTiming, clientBillingPeriodForDay } from './clientBillingCalendar.js';
export { clientPaymentTermDays } from './clientPaymentTerms.js';

const NON_ISSUED_INVOICE_STATUSES = new Set(['draft', 'cancelled', 'void']);
const PAID_INVOICE_STATUSES = new Set(['paid', 'settled', 'regularized']);

function normalizedStatus(invoice) {
  return String(invoice?.status || 'draft').trim().toLowerCase();
}

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function invoiceIsIssued(invoice) {
  return !NON_ISSUED_INVOICE_STATUSES.has(normalizedStatus(invoice))
    && Boolean(validDate(invoice?.issueDate));
}

export function invoiceIsPaid(invoice) {
  return PAID_INVOICE_STATUSES.has(normalizedStatus(invoice));
}

export function dueDateFromInvoiceIssue(issueDate, client) {
  const key = billingDueDate(billingDayKey(issueDate), client);
  return key ? new Date(`${key}T12:00:00Z`) : null;
}

export function effectiveInvoiceDueDate(invoice, client = invoice?.client) {
  if (!invoiceIsIssued(invoice)) return null;
  return dueDateFromInvoiceIssue(invoiceBillingReferenceDate(invoice, client), client);
}

export function invoiceBillingReferenceDate(invoice, client = invoice?.client) {
  if (Object.hasOwn(invoice || {}, 'billingReferenceDate')) return billingDayKey(invoice.billingReferenceDate);
  if (!['monthly', 'biweekly', 'per_event'].includes(client?.billingMethod)) return billingDayKey(invoice?.issueDate);
  const events = invoice?.events || (invoice?.event ? [invoice.event] : []);
  const references = new Set(events.flatMap((event) => {
    const first = clientBillingPeriodForDay(event.date, client);
    const last = clientBillingPeriodForDay(event.isContinuous ? event.endDate || event.date : event.date, client);
    return [first?.referenceDate, last?.referenceDate].filter(Boolean);
  }));
  if (references.size === 1) return [...references][0];
  const issued = billingDayKey(invoice?.issueDate);
  return references.size ? references.has(issued) ? issued : null : issued;
}

export function invoiceLifecycleState(invoice, today = new Date()) {
  if (!invoiceIsIssued(invoice)) return 'unbilled';
  if (invoiceIsPaid(invoice)) return 'regularized';

  const dueDate = effectiveInvoiceDueDate(invoice);
  if (!dueDate) return 'issued';

  const currentDate = validDate(today);
  if (!currentDate) return 'issued';
  return billingTiming(invoiceBillingReferenceDate(invoice), invoice.client, { outstanding: 1, now: currentDate }).status === 'overdue' ? 'overdue' : 'due';
}
