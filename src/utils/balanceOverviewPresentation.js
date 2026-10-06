import { invoiceIsIssued, invoiceIsPaid, effectiveInvoiceDueDate } from '../../shared/invoiceLifecycle.js';
import { buildClientFinancialSummary, invoiceEventIds } from './clientFinancialSummary.js';
import { normalizeBudgetStatus } from './budgetPipeline.js';
import { filterByFinancialPeriod } from './dashboardMetrics.js';
import { isBillableEventAssignment } from './eventFinancialRules.js';
import { isFinanceReadyEvent } from './financeReadiness.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';
import { staffPaymentRemaining } from './staffAdvances.js';

const sum = (rows) => Number(rows.reduce((total, row) => total + row.amount, 0).toFixed(2));

export function balanceMonthComparison(series, month, field) {
  const index = Number(month) - 1;
  if (!month || index < 1) return null;
  const previous = Number(series[index - 1]?.[field] || 0);
  if (previous <= 0) return null;
  return ((Number(series[index]?.[field] || 0) - previous) / previous) * 100;
}

export function balanceChartWindow(series, month) {
  if (!month) return series;
  const end = Number(month);
  return series.slice(Math.max(0, end - 6), end);
}

// These are read-only views of existing financial rules, never new ledger entries.
export function buildBalanceAttention({ eventRows = [], invoices = [], clients = [], today = new Date() } = {}) {
  const eventsById = new Map(eventRows.map((row) => [Number(row.id), row]));
  const clientsById = new Map(clients.map((client) => [String(client.id), client]));
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  const overdue = [];
  const seenInvoices = new Set();
  for (const invoice of invoices) {
    const row = [...new Set([...invoiceEventIds(invoice), Number(invoice.eventId)])]
      .map((id) => eventsById.get(id)).find(Boolean);
    if (!row || seenInvoices.has(invoice.id) || !invoiceIsIssued(invoice) || invoiceIsPaid(invoice)) continue;
    seenInvoices.add(invoice.id);
    const client = invoice.client || clientsById.get(String(invoice.clientId || row.clientId)) || row.event.client;
    const dueDate = effectiveInvoiceDueDate(invoice, client);
    if (!dueDate || dueDate >= day) continue;
    overdue.push({
      key: `invoice:${invoice.id}`, title: client?.name || row.clientName,
      subtitle: invoice.number || row.eventName, date: dueDate,
      amount: Number(invoice.total) || 0, to: `/finance?area=clients&invoiceId=${invoice.id}`,
    });
  }

  const staff = eventRows.filter((row) => isFinanceReadyEvent(row.event)).flatMap((row) => (
    (row.event.assignments || []).filter((assignment) => (
      assignment.collaboratorId && isBillableEventAssignment(assignment) && assignment.paymentStatus !== 'paid'
    )).map((assignment) => ({
      key: `assignment:${assignment.id}`,
      title: assignment.collaborator?.name || 'Colaborador', subtitle: row.eventName,
      date: assignment.assignmentDate || row.date,
      amount: staffPaymentRemaining(
        staffAssignmentPaymentTotal(assignment, row.event), assignment.advancePayments,
      ),
      to: `/finance?area=staff&assignmentId=${assignment.id}`,
    })).filter((entry) => entry.amount > 0)
  ));

  const readyEvents = eventRows.filter((row) => isFinanceReadyEvent(row.event)).map((row) => ({
    ...row.event, financial: { ...row.event.financial, revenue: row.revenue },
  }));
  const unbilled = buildClientFinancialSummary({ events: readyEvents, invoices, clients })
    .flatMap((row) => row.events.filter((event) => !event.invoices.some(invoiceIsIssued)).map((event) => ({
      key: `event:${event.id}`, title: event.name, subtitle: row.clientName, date: event.date,
      amount: event.displayValue, to: `/finance?area=clients&eventId=${event.id}`,
    })));
  return {
    overdue: { rows: overdue, amount: sum(overdue) },
    staff: { rows: staff, amount: sum(staff) },
    unbilled: { rows: unbilled, amount: sum(unbilled) },
  };
}

export function buildBalanceForecast({ eventRows = [], budgets = [], period = {} } = {}) {
  const confirmed = eventRows.filter((row) => (
    !isFinanceReadyEvent(row.event) && ['confirmed', 'team_complete'].includes(row.rawStatus)
  )).map((row) => ({
    key: `event:${row.id}`, title: row.eventName, subtitle: row.clientName, date: row.date,
    amount: row.revenue, to: `/services/${row.id}`,
  }));
  const pendingBudgets = period.status && period.status !== 'all' ? [] : filterByFinancialPeriod(
    budgets, period, (budget) => budget.eventDate,
  ).filter((budget) => (
    ['new_request', 'sent'].includes(normalizeBudgetStatus(budget.status))
    && (!period.clientId || period.clientId === 'all' || String(budget.clientId || budget.client?.id) === String(period.clientId))
  )).map((budget) => ({
    key: `budget:${budget.id}`, title: budget.reference || budget.eventName || budget.name || budget.title || 'Orçamento',
    subtitle: budget.client?.name || budget.clientName || budget.companyName || budget.leadName || '', date: budget.eventDate,
    amount: Number(budget.totalAmount || budget.amount) || 0, to: `/budgets?budgetId=${budget.id}`,
  }));
  return {
    confirmed: { rows: confirmed, amount: sum(confirmed) },
    budgets: { rows: pendingBudgets, amount: sum(pendingBudgets) },
  };
}
