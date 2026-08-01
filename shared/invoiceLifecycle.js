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

export function clientPaymentTermDays(client) {
  const paymentTerm = String(client?.paymentTerm || '').trim().toLowerCase();
  if (paymentTerm === 'immediate') return 0;
  if (paymentTerm === 'days_15') return 15;
  if (paymentTerm === 'days_30') return 30;
  if (paymentTerm === 'days_45') return 45;
  if (paymentTerm === 'custom') {
    const customDays = Number(client?.paymentTermDays);
    return Number.isFinite(customDays) && customDays >= 0 ? customDays : null;
  }
  return null;
}

export function invoiceIsIssued(invoice) {
  return !NON_ISSUED_INVOICE_STATUSES.has(normalizedStatus(invoice))
    && Boolean(validDate(invoice?.issueDate));
}

export function invoiceIsPaid(invoice) {
  return PAID_INVOICE_STATUSES.has(normalizedStatus(invoice));
}

export function dueDateFromInvoiceIssue(issueDate, client) {
  const issuedAt = validDate(issueDate);
  const paymentDays = clientPaymentTermDays(client);
  if (!issuedAt || paymentDays === null) return null;

  const dueDate = new Date(issuedAt);
  dueDate.setHours(0, 0, 0, 0);
  dueDate.setDate(dueDate.getDate() + paymentDays);
  return dueDate;
}

export function effectiveInvoiceDueDate(invoice, client = invoice?.client) {
  if (!invoiceIsIssued(invoice)) return null;
  return dueDateFromInvoiceIssue(invoice.issueDate, client);
}

export function invoiceLifecycleState(invoice, today = new Date()) {
  if (!invoiceIsIssued(invoice)) return 'unbilled';
  if (invoiceIsPaid(invoice)) return 'regularized';

  const dueDate = effectiveInvoiceDueDate(invoice);
  if (!dueDate) return 'issued';

  const currentDate = validDate(today);
  if (!currentDate) return 'issued';
  currentDate.setHours(0, 0, 0, 0);
  return dueDate < currentDate ? 'overdue' : 'due';
}

