import { externalCostsTotals } from './externalCosts.js';
import { eventTaxAmount } from './eventTax.js';
import {
  effectiveInvoiceDueDate,
  invoiceIsIssued,
  invoiceIsPaid,
} from '../../shared/invoiceLifecycle.js';

const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const finalizedStatuses = new Set(['finalized', 'completed', 'invoiced', 'paid']);

function numberValue(value) {
  const parsed = Number(String(value ?? 0).replace(/\s/g, '').replace('€', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (finalizedStatuses.has(status)) return 'finalized';
  return status || 'drafting';
}

function eventDate(event) {
  return validDate(event?.date || event?.startDate || event?.createdAt);
}

function eventClientId(event) {
  return String(event?.clientId || event?.client?.id || '');
}

function eventClientName(event) {
  return event?.client?.name || event?.clientName || event?.representativeName || 'Cliente por associar';
}

function eventClientKey(event) {
  return eventClientId(event) || `name:${eventClientName(event).trim().toLocaleLowerCase('pt')}`;
}

function eventRevenue(event) {
  return numberValue(
    event?.financial?.revenue
      ?? event?.calculatedTotalRevenue
      ?? event?.totalRevenue
      ?? event?.expectedRevenue
      ?? 0,
  );
}

function eventExternalCost(event) {
  if (event?.financial?.externalCost !== undefined && event?.financial?.externalCost !== null) {
    return numberValue(event.financial.externalCost);
  }
  return externalCostsTotals(event?.externalCosts).costAmount;
}

function eventStaffCost(event, externalCost) {
  const explicit = event?.financial?.staffCost ?? event?.financial?.staff;
  if (explicit !== undefined && explicit !== null) return numberValue(explicit);

  // The centralized event total includes external partner costs. Remove those
  // here so Balancete can show Staff and External Costs independently.
  return Math.max(0, numberValue(event?.totalCost ?? event?.staffCost ?? 0) - externalCost);
}

function inYear(date, year) {
  return !year || date.getFullYear() === Number(year);
}

function inMonth(date, month) {
  return !month || date.getMonth() + 1 === Number(month);
}

function matchesClient(event, clientId) {
  return !clientId || clientId === 'all' || eventClientId(event) === String(clientId);
}

function matchesStatus(event, status) {
  return !status || status === 'all' || normalizedStatus(event.status) === status;
}

function invoiceEventIds(invoice) {
  const ids = new Set();
  if (invoice?.eventId) ids.add(Number(invoice.eventId));
  const source = invoice?.eventIds;
  if (Array.isArray(source)) {
    source.forEach((value) => ids.add(Number(value)));
  } else if (source) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) parsed.forEach((value) => ids.add(Number(value)));
    } catch {
      String(source).split(',').forEach((value) => ids.add(Number(value.trim())));
    }
  }
  return new Set([...ids].filter(Number.isFinite));
}

function linkedInvoicesForEvent(event, invoices) {
  const eventId = Number(event?.id);
  return (invoices || [])
    .filter((invoice) => invoiceEventIds(invoice).has(eventId));
}

function openInvoiceDueDate(event, invoices) {
  return linkedInvoicesForEvent(event, invoices)
    .filter((invoice) => invoiceIsIssued(invoice) && !invoiceIsPaid(invoice))
    .map((invoice) => effectiveInvoiceDueDate(invoice, event?.client))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;
}

function rowFromEvent(event, invoices) {
  const date = eventDate(event);
  const revenue = eventRevenue(event);
  const external = eventExternalCost(event);
  const staff = eventStaffCost(event, external);
  const tax = eventTaxAmount(event);
  const margin = revenue - staff - external - tax;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
  const linkedInvoices = linkedInvoicesForEvent(event, invoices);
  const issuedInvoices = linkedInvoices.filter(invoiceIsIssued);
  const openInvoices = issuedInvoices.filter((invoice) => !invoiceIsPaid(invoice));
  const hasIssuedOpenInvoice = openInvoices.length > 0;
  const hasIssuedInvoices = issuedInvoices.length > 0;
  const billingState = hasIssuedOpenInvoice
    ? 'open'
    : hasIssuedInvoices
      ? 'settled'
      : 'unbilled';
  const receivable = Number(openInvoices
    .reduce((total, invoice) => total + numberValue(invoice.total), 0)
    .toFixed(2));
  return {
    id: event.id,
    event,
    eventName: event.name || 'Evento/Serviço',
    clientKey: eventClientKey(event),
    clientId: eventClientId(event),
    clientName: eventClientName(event),
    date,
    dueDate: openInvoiceDueDate(event, invoices),
    billingState,
    revenue,
    staff,
    external,
    tax,
    totalCost: Number((staff + external + tax).toFixed(2)),
    margin: Number(margin.toFixed(2)),
    marginPct,
    receivable,
    status: normalizedStatus(event.status),
    rawStatus: event.status || '',
  };
}

function periodRows(services, invoices, period) {
  return (services || [])
    .filter((event) => normalizedStatus(event.status) !== 'cancelled')
    .filter((event) => matchesClient(event, period.clientId))
    .filter((event) => matchesStatus(event, period.status))
    .map((event) => rowFromEvent(event, invoices))
    .filter((row) => row.date && inYear(row.date, period.year) && inMonth(row.date, period.month))
    .sort((a, b) => a.date - b.date || String(a.eventName).localeCompare(String(b.eventName), 'pt'));
}

function annualRows(services, invoices, period) {
  return (services || [])
    .filter((event) => normalizedStatus(event.status) !== 'cancelled')
    .filter((event) => matchesClient(event, period.clientId))
    .filter((event) => matchesStatus(event, period.status))
    .map((event) => rowFromEvent(event, invoices))
    .filter((row) => row.date && inYear(row.date, period.year));
}

function sum(rows, field) {
  return Number(rows.reduce((total, row) => total + numberValue(row[field]), 0).toFixed(2));
}

function buildMonthlySeries(rows) {
  return monthNames.map((month, index) => {
    const monthRows = rows.filter((row) => row.date.getMonth() === index);
    const receita = sum(monthRows, 'revenue');
    const staff = sum(monthRows, 'staff');
    const externos = sum(monthRows, 'external');
    const impostos = sum(monthRows, 'tax');
    const custos = Number((staff + externos + impostos).toFixed(2));
    const margem = Number((receita - custos).toFixed(2));
    return {
      month,
      receita,
      staff,
      externos,
      impostos,
      custos,
      margem,
      margemPct: receita > 0 ? Number(((margem / receita) * 100).toFixed(1)) : 0,
    };
  });
}

function dayDifference(from, to) {
  if (!from || !to) return 0;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function buildClientRows(rows, today) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.clientKey) || {
      key: row.clientKey,
      clientId: row.clientId,
      clientName: row.clientName,
      eventCount: 0,
      revenue: 0,
      staff: 0,
      external: 0,
      tax: 0,
      margin: 0,
      receivable: 0,
      nextDueDate: null,
      overdueDays: 0,
      eventIds: [],
      hasUnbilled: false,
      hasIssuedOpen: false,
    };
    current.eventCount += 1;
    current.revenue += row.revenue;
    current.staff += row.staff;
    current.external += row.external;
    current.tax += row.tax;
    current.margin += row.margin;
    current.receivable += row.receivable;
    current.eventIds.push(row.id);
    current.hasUnbilled = current.hasUnbilled || row.billingState === 'unbilled';
    current.hasIssuedOpen = current.hasIssuedOpen || row.billingState === 'open';
    if (row.receivable > 0 && row.dueDate && (!current.nextDueDate || row.dueDate < current.nextDueDate)) {
      current.nextDueDate = row.dueDate;
    }
    grouped.set(row.clientKey, current);
  }

  return [...grouped.values()]
    .map((row) => {
      const nextDueDate = validDate(row.nextDueDate);
      const overdue = row.receivable > 0 && nextDueDate && nextDueDate < today;
      return {
        ...row,
        revenue: Number(row.revenue.toFixed(2)),
        staff: Number(row.staff.toFixed(2)),
        external: Number(row.external.toFixed(2)),
        tax: Number(row.tax.toFixed(2)),
        margin: Number(row.margin.toFixed(2)),
        receivable: Number(row.receivable.toFixed(2)),
        marginPct: row.revenue > 0 ? Number(((row.margin / row.revenue) * 100).toFixed(1)) : 0,
        overdueDays: overdue ? dayDifference(nextDueDate, today) : 0,
        state: overdue
          ? 'overdue'
          : row.hasIssuedOpen
            ? 'open'
            : row.hasUnbilled
              ? 'unbilled'
              : 'settled',
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.clientName.localeCompare(b.clientName, 'pt'));
}

function buildAlerts(rows, clientRows) {
  const lowMarginRows = rows.filter((row) => row.revenue > 0 && row.marginPct < 20);
  const receivable = sum(rows, 'receivable');
  const staffRows = rows.filter((row) => row.staff > 0);
  const overdueClients = clientRows.filter((row) => row.overdueDays > 0);
  return {
    lowMarginEvents: { count: lowMarginRows.length, rows: lowMarginRows },
    clientsOpen: { count: clientRows.filter((row) => row.receivable > 0).length, value: receivable },
    overdueClients: { count: overdueClients.length, rows: overdueClients },
    staffToProcess: { count: staffRows.length, rows: staffRows },
  };
}

export function buildBalanceOverview({ services = [], invoices = [], period = {}, today = new Date() } = {}) {
  const currentRows = periodRows(services, invoices, period);
  const annual = annualRows(services, invoices, period);
  const clientRows = buildClientRows(currentRows, today);
  const validatedRevenue = sum(currentRows, 'revenue');
  const staffToPay = sum(currentRows, 'staff');
  const externalCosts = sum(currentRows, 'external');
  const taxCosts = sum(currentRows, 'tax');
  const realMargin = Number((validatedRevenue - staffToPay - externalCosts - taxCosts).toFixed(2));

  return {
    eventRows: currentRows,
    annualRows: annual,
    clientRows,
    monthlySeries: buildMonthlySeries(annual),
    alerts: buildAlerts(currentRows, clientRows),
    kpis: {
      validatedRevenue,
      staffToPay,
      externalCosts,
      taxCosts,
      realMargin,
      receivable: sum(currentRows, 'receivable'),
      finalizedEvents: currentRows.filter((row) => row.status === 'finalized').length,
      overdueClients: clientRows.filter((row) => row.overdueDays > 0).length,
    },
  };
}

export function buildClientBalanceSeries(rows = [], clientKey = '') {
  return buildMonthlySeries((rows || []).filter((row) => !clientKey || row.clientKey === clientKey));
}
