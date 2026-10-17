import { effectiveInvoiceDueDate, invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';
import { clientFinancialState } from './clientFinancialState.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';

export function normalizeCommercialIssueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

const calendarDay = (value) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());

// Read-only commercial timing; this does not create an invoice or change receivables.
export function clientPaymentDeadline(event = {}, { today = new Date(), payment = clientFinancialState(event) } = {}) {
  const client = event.client || {};
  const issued = (event.invoices || (event.invoice ? [event.invoice] : [])).filter(invoiceIsIssued);
  const open = issued.filter((invoice) => !invoiceIsPaid(invoice));
  const candidates = (open.length ? open : issued).map((invoice) => ({ invoice,
    dueDate: effectiveInvoiceDueDate(invoice, invoice.client || client) }));
  candidates.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  const record = readClientPaymentRecord(event.clientPaymentRecord);
  const commercial = record?.commercialStatus === 'invoiced' || record?.legacyInvoiced || event.billingStatus === 'invoiced' || event.status === 'invoiced';
  const issueDate = candidates[0]?.invoice.issueDate || (commercial ? normalizeCommercialIssueDate(record?.commercialIssueDate) : null);
  const source = issued.length ? 'invoice' : commercial ? 'commercial' : null;
  const dueDate = candidates[0]?.dueDate || (!issued.length && issueDate
    ? effectiveInvoiceDueDate({ status: 'issued', issueDate }, client) : null);
  const current = new Date(today);
  const overdueDays = dueDate && !Number.isNaN(current.getTime())
    ? Math.max(0, Math.round((calendarDay(current) - calendarDay(dueDate)) / 86400000)) : 0;
  const status = !source ? 'unbilled' : !payment.missingPayment ? 'paid' : !issueDate ? 'missing_issue_date'
    : !dueDate || Number.isNaN(current.getTime()) ? 'unknown' : overdueDays > 0 ? 'overdue'
      : calendarDay(current) === calendarDay(dueDate) ? 'due_today' : 'within_term';
  const label = status === 'overdue' ? `Vencida há ${overdueDays} ${overdueDays === 1 ? 'dia' : 'dias'}`
    : { unbilled: null, paid: 'Liquidado', missing_issue_date: 'Emissão por registar', unknown: 'Prazo por configurar',
      due_today: 'Vence hoje', within_term: 'Dentro do prazo' }[status];
  return { source, issueDate, dueDate, status, overdueDays, label };
}
