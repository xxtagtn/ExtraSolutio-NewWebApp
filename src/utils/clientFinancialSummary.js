import {
  effectiveInvoiceDueDate,
  invoiceIsIssued,
  invoiceIsPaid,
} from '../../shared/invoiceLifecycle.js';
import { externalCostsTotals } from './externalCosts.js';
import { eventTaxAmount } from './eventTax.js';
import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';
import { withInvoicePaymentCoverage } from '../../shared/invoicePaymentCoverage.js';

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

function roundMoney(value) {
  return Number(value.toFixed(2));
}

export function buildClientEventReconciliation(event = {}, operationalSummary = {}) {
  const revenue = eventRevenue(event);
  const total = numberValue(event?.displayValue ?? revenue);
  const adjustment = roundMoney(total - revenue);
  const days = Array.isArray(operationalSummary.days) ? operationalSummary.days : [];
  const dailyServiceSubtotal = roundMoney(days.reduce(
    (sum, day) => sum + numberValue(day.billableValue),
    0,
  ));
  const travel = event?.travelExpenseEnabled ? numberValue(event.travelExpenseAmount) : 0;
  const external = externalCostsTotals(event.externalCosts);
  const tax = eventTaxAmount(event);
  const itemizedSubtotal = dailyServiceSubtotal + travel + external.chargeAmount + tax + adjustment;
  const undiscriminated = roundMoney(total - itemizedSubtotal);

  return {
    revenue: roundMoney(revenue),
    total: roundMoney(total),
    dailyServiceSubtotal,
    travel: roundMoney(travel),
    externalCharge: external.chargeAmount,
    tax,
    adjustment,
    undiscriminated,
    dailyPricingComplete: days.length > 0 && days.every((day) => day.pricingComplete),
  };
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
    total: Number(row.total.toFixed(2)),
    invoiceIds: undefined,
  };
}

export function buildClientFinancialSummary({ events = [], invoices = [], clients = [], period = '' } = {}) {
  invoices = withInvoicePaymentCoverage(invoices, events);
  const clientsById = new Map(clients.map((client) => [String(client.id), client]));
  const summaries = new Map(), coveredInvoices = new Set();
  for (const original of events) {
    const linked = invoices.filter((invoice) => !CLOSED_INVOICE_STATUSES.has(invoice.status) && invoiceEventIds(invoice).includes(Number(original.id)));
    const event = { ...original, totalRevenue: original.totalRevenue ?? eventRevenue(original), client: clientsById.get(String(original.clientId)) || original.client, invoices: linked };
    const finance = event.clientFinance || buildClientFinanceSnapshot(event);
    const selected = finance.periods.filter((part) => !period || part.days.some((day) => dateInPeriod(day, period)));
    if (!selected.length) continue;
    const summary = ensureSummary(summaries, event, clientsById);
    summary.eventCount += 1;
    summary.allocationRequired ||= finance.allocationRequired;
    const issued = linked.filter(invoiceIsIssued);
    for (const invoice of issued) {
      coveredInvoices.add(invoice.id);
      if (!summary.invoiceIds.has(invoice.id)) { summary.invoiceIds.add(invoice.id); summary.invoices.push(invoice); }
    }
    for (const part of selected) {
      const value = part.total, received = part.received;
      const invoiced = finance.billingStatus === 'invoiced';
      summary.total += value || 0;
      summary.received += received || 0;
      if (invoiced) summary.billedOpen += part.outstanding || 0;
      else summary.pendingBilling += value || 0;
      summary.events.push({ ...event, clientFinance: finance, billingPeriod: part,
        displayValue: value, displayReceived: received, displayOutstanding: part.outstanding,
        displayAdjustment: finance.periods.length === 1 ? numberValue(event.billingAdjustment) : 0,
        invoice: linked[0] || null });
    }
    if (finance.periods.length === 1 && !linked.length) summary.adjustments += numberValue(event.billingAdjustment);
  }
  for (const invoice of invoices) {
    if (coveredInvoices.has(invoice.id) || !invoiceIsIssued(invoice) || (period && !dateInPeriod(invoice.issueDate, period) && !dateInPeriod(effectiveInvoiceDueDate(invoice, invoice.client), period))) continue;
    const ids = invoiceEventIds(invoice);
    if (ids.some((id) => events.some((event) => Number(event.id) === id))) continue;
    const client = invoice.client || clientsById.get(String(invoice.clientId));
    const summary = ensureSummary(summaries, { clientId: invoice.clientId, client, clientName: invoice.clientName }, clientsById);
    if (summary.invoiceIds.has(invoice.id)) continue;
    summary.invoiceIds.add(invoice.id); summary.invoices.push(invoice);
    summary.total += numberValue(invoice.total);
    if (invoiceIsPaid(invoice)) summary.received += numberValue(invoice.total);
    else summary.billedOpen += numberValue(invoice.total);
  }
  const unallocated = new Map();
  for (const invoice of invoices) {
    const ids = invoiceEventIds(invoice);
    if (!coveredInvoices.has(invoice.id) || !invoiceIsIssued(invoice) || !invoiceIsPaid(invoice) || ids.length < 2
      || Object.keys(invoice.eventPaymentCoverage || {}).length) continue;
    const summary = [...summaries.values()].find((row) => String(row.clientId) === String(invoice.clientId));
    if (!summary) continue;
    const group = unallocated.get(summary.key) || { amount: 0, ids: new Set() };
    group.amount += numberValue(invoice.total); ids.forEach((id) => group.ids.add(id)); unallocated.set(summary.key, group);
  }
  for (const [key, group] of unallocated) {
    const summary = summaries.get(key), seen = new Set();
    const represented = summary.events.reduce((sum, event) => {
      if (!group.ids.has(Number(event.id)) || seen.has(event.id)) return sum;
      seen.add(event.id); return sum + numberValue(event.clientFinance?.payment.received);
    }, 0);
    // Retain real grouped cash at client level without guessing its allocation to services.
    summary.unallocatedReceived = roundMoney(Math.max(0, group.amount - represented));
    summary.received += summary.unallocatedReceived;
    summary.billedOpen = Math.max(0, summary.billedOpen - summary.unallocatedReceived);
    summary.allocationRequired = true;
  }
  return [...summaries.values()].map(roundSummary)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-PT', { sensitivity: 'base' }));
}
