import { invoiceBillingReferenceDate, effectiveInvoiceDueDate } from '../../shared/invoiceLifecycle.js';
import { invoiceEventIds } from '../utils/eventInvoiceProtection.js';
import { withInvoicePaymentCoverage } from '../../shared/invoicePaymentCoverage.js';

export async function withGroupedServiceInvoices(db, events) {
  if (!events.length) return events;
  const grouped = await db.invoice.findMany({ where: { eventIds: { not: null } },
    select: { id: true, eventId: true, eventIds: true, number: true, status: true, issueDate: true, total: true } });
  const links = new Map(events.map((event) => [Number(event.id), new Map((event.invoices || []).map((invoice) => [invoice.id, invoice]))]));
  const ids = [...new Set(grouped.flatMap(invoiceEventIds))];
  const coverageEvents = ids.length ? await db.event.findMany({ where: { id: { in: ids } }, select: { id: true, totalRevenue: true } }) : [];
  for (const invoice of withInvoicePaymentCoverage(grouped, coverageEvents)) for (const id of invoiceEventIds(invoice)) links.get(id)?.set(invoice.id, invoice);
  return events.map((event) => ({ ...event, invoices: [...links.get(Number(event.id)).values()] }));
}

export async function serializeInvoiceBillingRows(db, invoices) {
  const ids = [...new Set(invoices.flatMap(invoiceEventIds))];
  const events = ids.length ? await db.event.findMany({ where: { id: { in: ids } },
    select: { id: true, date: true, endDate: true, isContinuous: true } }) : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  return invoices.map((invoice) => {
    const source = { ...invoice, events: invoiceEventIds(invoice).map((id) => byId.get(id)).filter(Boolean) };
    const billingReferenceDate = invoiceBillingReferenceDate(source);
    return { ...invoice, billingReferenceDate, dueDate: effectiveInvoiceDueDate({ ...source, billingReferenceDate }) };
  });
}
