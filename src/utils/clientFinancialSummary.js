import {
  effectiveInvoiceDueDate,
  invoiceIsIssued,
  invoiceIsPaid,
} from '../../shared/invoiceLifecycle.js';

const CLOSED_INVOICE_STATUSES = new Set(['cancelled', 'void']);

function numberValue(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateInPeriod(value, period) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const [year, month] = String(period || '').split('-').map(Number);
  if (!Number.isFinite(year)) return false;
  if (month === 0) return parsed.getFullYear() === year;
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month;
}

export function invoiceEventIds(invoice) {
  const source = invoice?.eventIds;
  if (Array.isArray(source)) return source.map(Number).filter(Number.isFinite);
  if (source) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) return parsed.map(Number).filter(Number.isFinite);
    } catch {
      return String(source).split(',').map(Number).filter(Number.isFinite);
    }
  }
  return invoice?.eventId ? [Number(invoice.eventId)].filter(Number.isFinite) : [];
}

function clientKeyFor(event) {
  const clientId = event?.clientId || event?.client?.id;
  if (clientId) return `client:${clientId}`;
  const name = event?.clientName || event?.representativeName || event?.client?.name || 'Cliente por associar';
  return `name:${String(name).trim().toLocaleLowerCase('pt-PT')}`;
}

function clientNameFor(event) {
  return event?.client?.name || event?.clientName || event?.representativeName || 'Cliente por associar';
}

function eventRevenue(event) {
  return numberValue(event?.financial?.revenue ?? event?.totalRevenue ?? event?.revenue);
}

function eventBillingState(event) {
  return String(event?.billingStatus || 'pending').toLowerCase();
}

function ensureSummary(map, event, clientsById) {
  const key = clientKeyFor(event);
  if (map.has(key)) return map.get(key);

  const clientId = event?.clientId || event?.client?.id || null;
  const registeredClient = clientId ? clientsById.get(String(clientId)) : null;
  const row = {
    key,
    clientId,
    clientName: clientNameFor(event),
    clientStatus: registeredClient?.status || event?.client?.status || 'active',
    eventCount: 0,
    pendingBilling: 0,
    adjustments: 0,
    billedOpen: 0,
    received: 0,
    total: 0,
    events: [],
    invoices: [],
    invoiceIds: new Set(),
  };
  map.set(key, row);
  return row;
}

function roundSummary(row) {
  return {
    ...row,
    pendingBilling: Number(row.pendingBilling.toFixed(2)),
    adjustments: Number(row.adjustments.toFixed(2)),
    billedOpen: Number(row.billedOpen.toFixed(2)),
    received: Number(row.received.toFixed(2)),
    total: Number((row.pendingBilling + row.billedOpen + row.received).toFixed(2)),
    invoiceIds: undefined,
  };
}

export function buildClientFinancialSummary({ events = [], invoices = [], clients = [], period = '' } = {}) {
  const clientsById = new Map((clients || []).map((client) => [String(client.id), client]));
  const eventIds = new Set((events || []).map((event) => Number(event.id)).filter(Number.isFinite));
  const availableInvoices = (invoices || []).filter((invoice) => {
    if (CLOSED_INVOICE_STATUSES.has(String(invoice?.status || '').toLowerCase())) return false;
    const linkedIds = invoiceEventIds(invoice);
    return linkedIds.some((id) => eventIds.has(id))
      || (invoiceIsIssued(invoice) && (
        dateInPeriod(invoice.issueDate, period)
        || dateInPeriod(effectiveInvoiceDueDate(invoice, invoice.client), period)
      ));
  });
  const allInvoices = (invoices || []).filter((invoice) => !CLOSED_INVOICE_STATUSES.has(String(invoice?.status || '').toLowerCase()));
  const eventById = new Map((events || []).map((event) => [Number(event.id), event]));
  const invoiceByEventId = new Map();

  for (const invoice of allInvoices) {
    for (const eventId of invoiceEventIds(invoice)) {
      if (!invoiceByEventId.has(eventId)) invoiceByEventId.set(eventId, []);
      invoiceByEventId.get(eventId).push(invoice);
    }
  }

  const summaries = new Map();

  for (const event of events || []) {
    const summary = ensureSummary(summaries, event, clientsById);
    const eventId = Number(event.id);
    const linkedInvoices = invoiceByEventId.get(eventId) || [];
    const revenue = eventRevenue(event);
    const adjustment = linkedInvoices.length ? 0 : numberValue(event.billingAdjustment);
    const adjustedRevenue = Math.max(0, revenue + adjustment);
    const billingStatus = eventBillingState(event);

    summary.eventCount += 1;
    summary.adjustments += adjustment;
    summary.events.push({
      ...event,
      displayValue: adjustedRevenue,
      displayAdjustment: adjustment,
      billingStatus,
      invoices: linkedInvoices,
      invoice: linkedInvoices[0] || null,
    });

    if (!linkedInvoices.some((invoice) => invoiceIsIssued(invoice))) {
      summary.pendingBilling += adjustedRevenue;
    }
  }

  for (const invoice of availableInvoices) {
    const linkedIds = invoiceEventIds(invoice);
    const linkedEvent = linkedIds.map((id) => eventById.get(id)).find(Boolean);
    const clientId = invoice.clientId || linkedEvent?.clientId || linkedEvent?.client?.id;
    const fallbackEvent = linkedEvent || {
      clientId,
      client: clientId ? clientsById.get(String(clientId)) : null,
      clientName: invoice.clientName,
    };
    const summary = ensureSummary(summaries, fallbackEvent, clientsById);
    if (summary.invoiceIds.has(invoice.id)) continue;
    if (!invoiceIsIssued(invoice)) continue;

    const total = numberValue(invoice.total);
    summary.invoiceIds.add(invoice.id);
    summary.invoices.push(invoice);
    if (invoiceIsPaid(invoice)) summary.received += total;
    else summary.billedOpen += total;
  }

  return [...summaries.values()]
    .map((row) => roundSummary({
      ...row,
      events: row.events.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()),
      invoices: row.invoices.sort((a, b) => new Date(b.issueDate || 0).getTime() - new Date(a.issueDate || 0).getTime()),
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-PT', { sensitivity: 'base' }));
}
