import { invoiceIsIssued, invoiceIsPaid } from './invoiceLifecycle.js';

const cents = (value) => Math.max(0, Math.round(Number(value || 0) * 100));

export function paymentInvoiceEventIds(invoice = {}) {
  let ids = invoice.eventIds;
  if (!Array.isArray(ids)) {
    try { ids = JSON.parse(ids || '[]'); } catch { ids = String(ids || '').split(','); }
  }
  return [...new Set([...(Array.isArray(ids) ? ids : []), invoice.eventId].map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export function withInvoicePaymentCoverage(invoices, events) {
  const totals = new Map(events.map((event) => [Number(event.id), cents(event.totalRevenue)]));
  return invoices.map((invoice) => {
    const ids = paymentInvoiceEventIds(invoice);
    if (ids.length < 2) return invoice;
    const complete = ids.every((id) => totals.has(id));
    const total = ids.reduce((sum, id) => sum + (totals.get(id) || 0), 0);
    // A global partial invoice has no unambiguous allocation to individual services.
    return { ...invoice, eventPaymentCoverage: complete && cents(invoice.total) === total
      ? Object.fromEntries(ids.map((id) => [id, totals.get(id) / 100])) : {} };
  });
}

export function paidInvoiceCoverage(event = {}) {
  const seen = new Set();
  return (event.invoices || (event.invoice ? [event.invoice] : [])).reduce((sum, invoice) => {
    if (!invoiceIsIssued(invoice) || !invoiceIsPaid(invoice) || (invoice.id != null && seen.has(invoice.id))) return sum;
    if (invoice.id != null) seen.add(invoice.id);
    const ids = paymentInvoiceEventIds(invoice);
    if (ids.length > 1) return sum + cents(invoice.eventPaymentCoverage?.[event.id]) / 100;
    if (ids.length && event.id != null && ids[0] !== Number(event.id)) return sum;
    return sum + cents(invoice.total) / 100;
  }, 0);
}
