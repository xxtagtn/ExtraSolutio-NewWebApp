import {
  Banknote,
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  NotebookPen,
  Plus,
  ReceiptText,
  TrendingUp,
  CheckCircle2,
  Hourglass,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import {
  billingEventIdsForRow,
  billingPaymentDateForRow,
  billingStatusForRow,
  billingValueForRow,
  clientBillingRowsForActiveEvents,
  dueDateForBillingGroup,
  expandClientBillingRows,
  filterBillingGroupsByPeriod,
  filterInvoicesByPeriod,
  filterServicesByPeriod,
  splitClientBillingRows,
} from '../utils/clientBilling.js';
import { externalCostsTotals } from '../utils/externalCosts.js';
import { splitFinanceReadiness } from '../utils/financeReadiness.js';
import { date, durationHours, money } from '../utils/formatters.js';
import { clientChargeHours, decimalValue, staffWorkedHours } from '../utils/serviceFinance.js';
import {
  normalizeStaffAdvances,
  staffAdvancesTotal,
  staffCarAdvancesTotal,
  staffPaymentRemaining,
} from '../utils/staffAdvances.js';
import {
  buildMoveToPaidPayload,
  buildStaffPaymentStatusPayload,
} from '../utils/staffPaymentBulk.js';
import { staffPaymentLinkSelection } from '../utils/deepLinks.js';
import {
  assignmentWorkDateValue,
  nextStaffPaymentMonth,
  staffPaymentTiming,
  staffPaymentTotal,
} from '../utils/staffPayment.js';
import { hasPaymentNotes, normalizePaymentNotes } from '../utils/staffPaymentNotes.js';

const AREA_TABS = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'clients', label: 'Clientes' },
  { id: 'staff', label: 'Staff' },
  { id: 'margins', label: 'Margens' },
  { id: 'archive', label: 'Arquivo' },
];

const PAYMENT_STATUS = [
  { value: 'unpaid', label: 'Por pagar' },
  { value: 'validated_es', label: 'Validado ES' },
  { value: 'paid', label: 'Pago' },
  { value: 'awaiting_data', label: 'Aguardar por RV' },
];

const BILLING_STATUS = [
  { value: 'pending', label: 'Pendente' },
  { value: 'partial70', label: 'Sinalização' },
  { value: 'invoiced', label: 'Faturado' },
  { value: 'paid', label: 'Pago' },
];

const INVOICE_STATUS = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'issued', label: 'Emitida' },
  { value: 'paid', label: 'Paga' },
  { value: 'cancelled', label: 'Anulada' },
];

const BILLING_METHOD_LABELS = {
  prepaid: 'Pré-pagamento',
  per_event: 'Por evento',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  custom: 'Personalizado',
};

const EXPENSE_CATEGORIES = [
  'Combustível',
  'Portagens',
  'Google Ads',
  'ChatGPT',
  'Telecomunicações',
  'Software',
  'Material escritório',
  'Vestuário',
  'Formação',
  'Outros',
];

const NON_BILLABLE_ASSIGNMENT = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const CLOSED_BILLING_STATUSES = new Set(['partial70', 'invoiced', 'paid']);
const MONTH_OPTIONS = [
  { value: '00', label: 'Todos os meses' },
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Marco' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
];

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthInputValue(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function monthDate(month) {
  const [year, monthNumber] = String(month || monthInputValue()).split('-').map(Number);
  return new Date(year, monthNumber - 1, 1);
}

function monthLabel(month) {
  const [year, monthNumber] = String(month || monthInputValue()).split('-').map(Number);
  if (monthNumber === 0) return `Todos os meses de ${year}`;
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(monthDate(month));
}

function dateInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSameMonth(value, month) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const [selectedYear, selectedMonth] = String(month || monthInputValue()).split('-').map(Number);
  if (selectedMonth === 0) return d.getFullYear() === selectedYear;
  return monthInputValue(d) === month;
}

function monthKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Sem data';
  return monthInputValue(d);
}

function dayDiffFromToday(value) {
  if (!value) return 0;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.floor((today.getTime() - targetDay.getTime()) / 86_400_000);
}

function normalizeAssignmentStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function billableAssignments(event) {
  return (event.assignments || []).filter((assignment) => !NON_BILLABLE_ASSIGNMENT.has(normalizeAssignmentStatus(assignment.status)));
}

function assignmentHours(assignment) {
  return staffWorkedHours(assignment);
}

function assignmentBasePay(assignment) {
  const hours = assignmentHours(assignment);
  const hourlyRate = num(assignment.hourlyRate);
  if (hours > 0 && hourlyRate > 0) return hours * hourlyRate;
  const explicit = num(assignment.totalPay);
  if (explicit > 0) return explicit;
  return hours * hourlyRate;
}

function assignmentPayWithVat(assignment) {
  const base = assignmentBasePay(assignment);
  const includesVat = Boolean(assignment?.collaborator?.includeVat);
  return staffPaymentTotal(base, includesVat, assignment.paymentAdjustment);
}

function assignmentAdvances(assignment) {
  return normalizeStaffAdvances(assignment.advancePayments);
}

function assignmentAdvanceTotal(assignment) {
  return staffAdvancesTotal(assignmentAdvances(assignment));
}

function assignmentCarAdvanceTotal(assignment) {
  return staffCarAdvancesTotal(assignmentAdvances(assignment));
}

function assignmentStaffCostTotal(assignment) {
  return Number((assignmentPayWithVat(assignment) + assignmentCarAdvanceTotal(assignment)).toFixed(2));
}

function assignmentOutstandingPay(assignment) {
  return staffPaymentRemaining(assignmentPayWithVat(assignment), assignmentAdvances(assignment));
}

function adjustmentInputValue(value) {
  const parsed = decimalValue(value) || 0;
  if (parsed === 0) return '';
  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(2).replace('.', ',')}`;
}

function paymentMonthMatches(assignment, period) {
  const paymentMonth = staffPaymentTiming(assignment).paymentMonth;
  if (!paymentMonth) return false;
  const [year, month] = String(period || monthInputValue()).split('-');
  if (month === '00') return paymentMonth.startsWith(`${year}-`);
  return paymentMonth === period;
}

function assignmentWorkDateInputValue(assignment) {
  return dateInputValue(assignmentWorkDateValue(assignment));
}

function assignmentWorkDateTimestamp(assignment) {
  const value = assignmentWorkDateValue(assignment);
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function paymentWindowLabel(timing) {
  if (!timing?.start || !timing?.end) return '-';
  const start = String(timing.start.getDate()).padStart(2, '0');
  const end = String(timing.end.getDate()).padStart(2, '0');
  return `${start}-${end} ${new Intl.DateTimeFormat('pt-PT', { month: 'short', year: 'numeric' }).format(timing.start)}`;
}

function paymentTimingLabel(status) {
  if (status === 'not_open') return 'Ainda não aberto';
  if (status === 'open') return 'Período aberto';
  if (status === 'overdue') return 'Em atraso';
  if (status === 'paid') return 'Pago';
  return 'Sem data';
}

function eventStaffCost(event) {
  const total = billableAssignments(event).reduce((sum, assignment) => sum + assignmentStaffCostTotal(assignment), 0);
  return total || num(event.totalCost);
}

function eventRoleRates(event) {
  try {
    const roles = Array.isArray(event.requiredRoles)
      ? event.requiredRoles
      : JSON.parse(event.requiredRoles || '[]');
    return new Map(roles.map((item) => [item.role, num(item.agreedRate)]));
  } catch {
    return new Map();
  }
}

function eventRevenue(event) {
  const roleRates = eventRoleRates(event);
  const assignmentRevenue = billableAssignments(event).reduce((sum, assignment) => {
    const hours = clientChargeHours(
      assignment,
      event.startTime,
      event.endTime,
      event.minimumHoursSnapshot,
    );
    return sum + (hours * (roleRates.get(assignment.role) || 0));
  }, 0);
  const travel = event.travelExpenseEnabled ? num(event.travelExpenseAmount) : 0;
  const externalTotals = externalCostsTotals(event.externalCosts);
  const calculated = assignmentRevenue + travel + externalTotals.chargeAmount;
  return calculated > 0 ? calculated : num(event.totalRevenue);
}

function eventFinancialRow(event, invoices, expenses) {
  const eventInvoices = invoices.filter((invoice) => invoiceIncludesEvent(invoice, event.id));
  const linkedExpenses = expenses.filter((expense) => Number(expense.referenceId) === Number(event.id));
  const revenue = eventRevenue(event);
  const staff = eventStaffCost(event);
  const externalTotals = externalCostsTotals(event.externalCosts);
  const operational = num(event.travelExpenseAmount)
    + externalTotals.costAmount
    + linkedExpenses.reduce((sum, expense) => sum + num(expense.amount), 0);
  const margin = revenue - staff - operational;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const paidByInvoice = eventInvoices.filter(invoiceIsPaid).reduce((sum, invoice) => sum + num(invoice.total), 0);
  const paidBySignal = num(event.paidAmount);
  const received = Math.max(paidByInvoice, event.billingStatus === 'paid' ? revenue : paidBySignal);
  const receivable = Math.max(0, revenue - received);
  return {
    ...event,
    financial: {
      revenue,
      staff,
      operational,
      margin,
      marginPct,
      received,
      receivable,
      invoiceCount: eventInvoices.length,
      hasInvoice: eventInvoices.length > 0,
      linkedExpenses,
    },
  };
}

function invoiceIsPaid(invoice) {
  return invoice.status === 'paid';
}

function invoiceIsIssued(invoice) {
  return invoice.status !== 'draft' && invoice.status !== 'cancelled';
}

function parseInvoiceEventIds(invoice) {
  if (invoice.eventIds) {
    try {
      return JSON.parse(invoice.eventIds).map(Number);
    } catch {
      return [];
    }
  }
  return invoice.eventId ? [Number(invoice.eventId)] : [];
}

function invoiceIncludesEvent(invoice, eventId) {
  if (invoice.status === 'cancelled') return false;
  return parseInvoiceEventIds(invoice).includes(Number(eventId));
}

function startOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(value, days) {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function paymentTermDays(client) {
  if (client?.paymentTerm === 'immediate') return 0;
  if (client?.paymentTerm === 'days_15') return 15;
  if (client?.paymentTerm === 'days_30') return 30;
  if (client?.paymentTerm === 'days_45') return 45;
  if (client?.paymentTerm === 'custom') return Number(client.paymentTermDays || 0);
  return 30;
}

function dueDateForGroup(group) {
  return dueDateForBillingGroup(group);
}

function dueDateForService(client, service) {
  if (!service?.date) return null;
  const serviceDate = startOfDay(service.date);
  const method = client?.billingMethod || 'per_event';
  if (method === 'monthly') return lastDayOfMonth(serviceDate.getFullYear(), serviceDate.getMonth());
  if (method === 'biweekly') return serviceDate.getDate() <= 15
    ? new Date(serviceDate.getFullYear(), serviceDate.getMonth(), 15)
    : lastDayOfMonth(serviceDate.getFullYear(), serviceDate.getMonth());
  if (method === 'custom') return addDays(lastDayOfMonth(serviceDate.getFullYear(), serviceDate.getMonth()), paymentTermDays(client));
  return serviceDate; // per_event, prepaid
}

function groupKeyForEvent(event) {
  const client = event.client || {};
  const method = client.billingMethod || 'per_event';
  const d = new Date(event.date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  if (method === 'monthly') {
    return {
      key: `${client.id}:monthly:${year}-${month}`,
      label: `${client.name} · ${monthLabel(monthInputValue(d))}`,
      issueDate: lastDayOfMonth(year, month),
    };
  }

  if (method === 'biweekly') {
    const half = day <= 15 ? 1 : 2;
    return {
      key: `${client.id}:biweekly:${year}-${month}:${half}`,
      label: `${client.name} · ${half === 1 ? '1.ª quinzena' : '2.ª quinzena'} ${monthLabel(monthInputValue(d))}`,
      issueDate: half === 1 ? new Date(year, month, 15) : lastDayOfMonth(year, month),
    };
  }

  if (method === 'custom') {
    return {
      key: `${client.id}:custom:${year}-${month}`,
      label: `${client.name} · ${client.billingCustomRule || monthLabel(monthInputValue(d))}`,
      issueDate: lastDayOfMonth(year, month),
    };
  }

  return {
    key: `${client.id}:${method}:${event.id}`,
    label: `${client.name || 'Cliente'} · ${event.name}`,
    issueDate: method === 'prepaid' ? new Date() : addDays(d, 1),
  };
}

function buildBillingGroups(events, invoices) {
  const groups = new Map();
  for (const event of events) {
    const total = eventRevenue(event);
    if (!event.clientId || !event.client?.id || !event.date || total <= 0) continue;
    if (invoices.some((invoice) => invoiceIncludesEvent(invoice, event.id))) continue;
    if (CLOSED_BILLING_STATUSES.has(String(event.billingStatus || ''))) continue;

    const method = event.client?.billingMethod || 'per_event';
    const info = groupKeyForEvent(event);
    const current = groups.get(info.key) || {
      key: info.key,
      client: event.client,
      method,
      label: info.label,
      issueDate: info.issueDate,
      dueDate: null,
      events: [],
      total: 0,
    };
    current.events.push(event);
    current.total += total;
    current.dueDate = dueDateForGroup(current);
    groups.set(info.key, current);
  }
  return [...groups.values()].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
}

function statusLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value || '-';
}

function emptyExpense() {
  return {
    date: todayIso(),
    supplier: '',
    category: 'Outros',
    amount: '',
    vatAmount: '',
    referenceId: '',
    description: '',
    documentName: '',
    documentData: '',
    sentToAccountant: false,
  };
}

function topItems(items, count = 5) {
  return items.slice(0, count);
}

export default function Accounting() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: services, loading, error, reload } = useApi('/services', []);
  const { data: invoices, reload: reloadInvoices } = useApi('/invoices', []);
  const { data: clients } = useApi('/clients', []);
  const { data: transactions, reload: reloadTransactions } = useApi('/transactions', []);
  const [activeArea, setActiveArea] = useState(() => {
    const area = searchParams.get('area');
    return AREA_TABS.some((tab) => tab.id === area) ? area : 'overview';
  });
  const [selectedMonth, setSelectedMonth] = useState(() => monthInputValue());
  const [archiveMonth, setArchiveMonth] = useState(() => `${new Date().getFullYear()}-00`);
  const [archiveClientId, setArchiveClientId] = useState('all');
  const [staffFilters, setStaffFilters] = useState({ eventId: 'all', collaboratorId: 'all', date: '' });
  const [staffPaymentTab, setStaffPaymentTab] = useState('unpaid');
  const [pendingStaffAssignmentLink, setPendingStaffAssignmentLink] = useState('');
  const [staffPaymentDrafts, setStaffPaymentDrafts] = useState({});
  const [selectedStaffPaymentIds, setSelectedStaffPaymentIds] = useState([]);
  const [bulkPaymentStatus, setBulkPaymentStatus] = useState('paid');
  const [bulkPaymentDate, setBulkPaymentDate] = useState(todayIso());
  const [bulkUpdatingPayments, setBulkUpdatingPayments] = useState(false);
  const [paymentNotesAssignment, setPaymentNotesAssignment] = useState(null);
  const [paymentNotesDraft, setPaymentNotesDraft] = useState('');
  const [paymentNotesOverrides, setPaymentNotesOverrides] = useState({});
  const [savingPaymentNotes, setSavingPaymentNotes] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [expandedArchiveClientId, setExpandedArchiveClientId] = useState(null);
  const [updatingAssignmentId, setUpdatingAssignmentId] = useState(null);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState(null);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [expenseForm, setExpenseForm] = useState(emptyExpense());
  const [expenseError, setExpenseError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [bankBalance, setBankBalance] = useState('');
  const [savingBankBalance, setSavingBankBalance] = useState(false);
  const [selectedYear, selectedMonthNumber] = String(selectedMonth || monthInputValue()).split('-');
  const [archiveYear, archiveMonthNumber] = String(archiveMonth || `${new Date().getFullYear()}-00`).split('-');

  useEffect(() => {
    const area = searchParams.get('area');
    if (AREA_TABS.some((tab) => tab.id === area) && area !== activeArea) {
      setActiveArea(area);
    }
  }, [activeArea, searchParams]);

  useEffect(() => {
    const area = searchParams.get('area');
    if (area !== 'clients') return;

    const eventId = searchParams.get('eventId');
    const invoiceId = searchParams.get('invoiceId');
    if (!eventId && !invoiceId) return;

    if (eventId) {
      const event = services.find((item) => String(item.id) === String(eventId));
      if (event?.date) setSelectedMonth(monthInputValue(new Date(event.date)));
    }

    if (invoiceId) {
      const invoice = invoices.find((item) => String(item.id) === String(invoiceId));
      const invoiceDate = invoice?.issueDate || invoice?.dueDate || invoice?.createdAt;
      if (invoiceDate) setSelectedMonth(monthInputValue(new Date(invoiceDate)));
    }
  }, [invoices, searchParams, services]);

  function selectArea(area) {
    setActiveArea(area);
    const nextParams = new window.URLSearchParams(searchParams);
    if (area === 'overview') nextParams.delete('area');
    else nextParams.set('area', area);
    setSearchParams(nextParams, { replace: true });
  }

  const { readyEvents: financeServices, forecastEvents: forecastServices } = useMemo(
    () => splitFinanceReadiness(services),
    [services],
  );

  const expenses = useMemo(
    () => (transactions || []).filter((transaction) => transaction.type === 'expense'),
    [transactions],
  );

  const latestBankBalance = useMemo(
    () => [...(transactions || [])]
      .filter((transaction) => transaction.type === 'treasury_balance' && transaction.category === 'bank_balance')
      .sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())[0],
    [transactions],
  );

  useEffect(() => {
    if (latestBankBalance) setBankBalance(String(num(latestBankBalance.amount)));
  }, [latestBankBalance]);

  const currentMonthInvoices = useMemo(
    () => invoices.filter((invoice) => isSameMonth(invoice.issueDate, selectedMonth)),
    [invoices, selectedMonth],
  );

  const currentMonthExpenses = useMemo(
    () => expenses.filter((expense) => isSameMonth(expense.date, selectedMonth)),
    [expenses, selectedMonth],
  );

  const yearOptions = useMemo(() => {
    const years = new Set([String(new Date().getFullYear())]);
    for (const event of services) {
      if (event?.date) years.add(String(new Date(event.date).getFullYear()));
      for (const assignment of billableAssignments(event)) {
        const paymentMonth = staffPaymentTiming({ ...assignment, event }).paymentMonth;
        if (paymentMonth) years.add(paymentMonth.slice(0, 4));
      }
    }
    for (const invoice of invoices) {
      if (invoice?.issueDate) years.add(String(new Date(invoice.issueDate).getFullYear()));
    }
    for (const expense of expenses) {
      if (expense?.date) years.add(String(new Date(expense.date).getFullYear()));
    }
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [services, invoices, expenses]);

  const eventRows = useMemo(
    () => financeServices.map((event) => eventFinancialRow(event, invoices, expenses)),
    [financeServices, invoices, expenses],
  );

  const forecastEventRows = useMemo(
    () => forecastServices.map((event) => eventFinancialRow(event, invoices, expenses)),
    [forecastServices, invoices, expenses],
  );

  const currentEventRows = useMemo(
    () => eventRows.filter((event) => isSameMonth(event.date, selectedMonth)),
    [eventRows, selectedMonth],
  );

  const currentForecastEventRows = useMemo(
    () => forecastEventRows.filter((event) => isSameMonth(event.date, selectedMonth)),
    [forecastEventRows, selectedMonth],
  );

  const billingGroups = useMemo(
    () => buildBillingGroups(financeServices, invoices),
    [financeServices, invoices],
  );

  const forecastBillingGroups = useMemo(
    () => buildBillingGroups(forecastEventRows, invoices),
    [forecastEventRows, invoices],
  );

  const currentBillingGroups = useMemo(
    () => filterBillingGroupsByPeriod(billingGroups, selectedMonth),
    [billingGroups, selectedMonth],
  );

  const currentForecastBillingGroups = useMemo(
    () => filterBillingGroupsByPeriod(forecastBillingGroups, selectedMonth),
    [forecastBillingGroups, selectedMonth],
  );

  const dashboard = useMemo(() => {
    const invoiceIssued = currentMonthInvoices.filter(invoiceIsIssued).reduce((sum, invoice) => sum + num(invoice.total), 0);
    const directIssued = currentEventRows
      .filter((event) => !event.financial.hasInvoice && ['invoiced', 'paid'].includes(String(event.billingStatus || '')))
      .reduce((sum, event) => sum + event.financial.revenue, 0);
    const issued = invoiceIssued + directIssued;
    const received = currentEventRows.reduce((sum, event) => sum + event.financial.received, 0);
    const staff = currentEventRows.reduce((sum, event) => sum + event.financial.staff, 0);
    const operational = currentMonthExpenses.reduce((sum, expense) => sum + num(expense.amount), 0);
    const vatLiquidated = currentMonthInvoices.filter(invoiceIsIssued).reduce((sum, invoice) => sum + num(invoice.taxAmount), 0);
    const vatSupported = currentMonthExpenses.reduce((sum, expense) => sum + num(expense.vatAmount), 0);
    return {
      issued,
      received,
      staff,
      operational,
      provisionalResult: received - staff - operational,
      vatLiquidated,
      vatSupported,
      vatEstimated: vatLiquidated - vatSupported,
    };
  }, [currentMonthInvoices, currentEventRows, currentMonthExpenses]);

  const buildClientRowsForPeriod = useCallback((period, sourceEventRows = eventRows, sourceBillingGroups = billingGroups) => {
    const periodEventRows = filterServicesByPeriod(sourceEventRows, period);
    const periodDirectReceivableByClient = new Map();
    for (const event of periodEventRows) {
      if (!event.clientId || event.financial.receivable <= 0) continue;
      if (event.financial.hasInvoice) continue;
      if (!['paid', 'partial70'].includes(String(event.billingStatus || ''))) continue;
      const key = Number(event.clientId);
      periodDirectReceivableByClient.set(key, (periodDirectReceivableByClient.get(key) || 0) + num(event.financial.receivable));
    }

    return clients.flatMap((client) => {
      const clientInvoices = invoices.filter((invoice) => Number(invoice.clientId) === Number(client.id));
      const periodInvoices = filterInvoicesByPeriod(clientInvoices, period);
      const unpaidInvoices = periodInvoices.filter((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled');
      const clientGroups = filterBillingGroupsByPeriod(
        sourceBillingGroups.filter((group) => Number(group.client?.id) === Number(client.id)),
        period,
      );
      const billedOpen = num(periodDirectReceivableByClient.get(Number(client.id)));
      const overdue = unpaidInvoices
        .map((invoice) => ({ invoice, days: dayDiffFromToday(invoice.dueDate) }))
        .filter((item) => item.days > 0)
        .sort((a, b) => b.days - a.days)[0];
      const invoiceDebt = unpaidInvoices.reduce((sum, invoice) => sum + num(invoice.total), 0);
      const pendingBilling = clientGroups.reduce((sum, group) => sum + num(group.total), 0);
      const nonInvoicedServices = periodEventRows
        .filter((event) => Number(event.clientId) === Number(client.id) && !event.financial.hasInvoice)
        .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
      const actionableService = nonInvoicedServices.find((event) => ['pending', 'partial70', 'paid', 'invoiced'].includes(String(event.billingStatus || '')))
        || nonInvoicedServices[0]
        || null;
      const openServiceReceivable = nonInvoicedServices
        .filter((event) => ['invoiced', 'paid', 'partial70'].includes(String(event.billingStatus || '')))
        .reduce((sum, event) => sum + num(event.financial.receivable), 0);
      const openServiceCount = nonInvoicedServices
        .filter((event) => ['invoiced', 'paid', 'partial70'].includes(String(event.billingStatus || '')))
        .length;
      const totalOpen = invoiceDebt + pendingBilling + openServiceReceivable;
      const actionableInvoice = unpaidInvoices
        .sort((a, b) => new Date(a.issueDate || 0).getTime() - new Date(b.issueDate || 0).getTime())[0] || null;
      const clientRow = {
        ...client,
        invoices: periodInvoices
          .filter((invoice) => invoice.status !== 'cancelled')
          .sort((a, b) => new Date(b.issueDate || 0).getTime() - new Date(a.issueDate || 0).getTime()),
        billingGroups: clientGroups,
        nonInvoicedServices,
        actionableInvoice,
        actionableService,
        invoicesCount: unpaidInvoices.length + openServiceCount,
        invoiceDebt,
        pendingBilling,
        billedOpen,
        totalOpen,
        overdueDays: overdue?.days || 0,
        nextDueDate: (() => {
          const nextInvoiceDueDate = unpaidInvoices
            .filter((invoice) => invoice.dueDate)
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0]?.dueDate;
          const nextServiceDueDate = nonInvoicedServices
            .map((service) => dueDateForService(client, service))
            .concat(clientGroups.map((group) => group.dueDate))
            .filter(Boolean)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
          if (nextInvoiceDueDate && nextServiceDueDate) {
            return new Date(nextInvoiceDueDate).getTime() <= new Date(nextServiceDueDate).getTime()
              ? nextInvoiceDueDate
              : nextServiceDueDate;
          }
          return nextInvoiceDueDate || nextServiceDueDate || null;
        })(),
      };
      return expandClientBillingRows(clientRow, { overdueDaysFromDate: dayDiffFromToday });
    }).sort((a, b) => {
      const dateDiff = new Date(a.nextDueDate || 0).getTime() - new Date(b.nextDueDate || 0).getTime();
      if (dateDiff) return dateDiff;
      return b.totalOpen - a.totalOpen;
    });
  }, [billingGroups, clients, eventRows, invoices]);

  const selectedPeriodClientRows = useMemo(
    () => buildClientRowsForPeriod(selectedMonth),
    [buildClientRowsForPeriod, selectedMonth],
  );

  const selectedForecastClientRows = useMemo(
    () => buildClientRowsForPeriod(selectedMonth, forecastEventRows, forecastBillingGroups),
    [buildClientRowsForPeriod, forecastBillingGroups, forecastEventRows, selectedMonth],
  );

  const { activeRows: activeClientRows } = useMemo(
    () => splitClientBillingRows(selectedPeriodClientRows),
    [selectedPeriodClientRows],
  );

  const { activeRows: activeForecastClientRows } = useMemo(
    () => splitClientBillingRows(selectedForecastClientRows),
    [selectedForecastClientRows],
  );

  const clientRows = useMemo(
    () => clientBillingRowsForActiveEvents(activeClientRows),
    [activeClientRows],
  );

  useEffect(() => {
    if (activeArea !== 'clients') return;

    const eventId = searchParams.get('eventId');
    const invoiceId = searchParams.get('invoiceId');
    if (!eventId && !invoiceId) return;

    const targetRow = clientRows.find((row) => {
      if (eventId) {
        if (billingEventIdsForRow(row).some((id) => String(id) === String(eventId))) return true;
        if ((row.nonInvoicedServices || []).some((event) => String(event.id) === String(eventId))) return true;
      }
      if (invoiceId && (row.invoices || []).some((invoice) => String(invoice.id) === String(invoiceId))) return true;
      return false;
    });

    if (targetRow) setExpandedClientId(targetRow.rowId || targetRow.id);
  }, [activeArea, clientRows, searchParams]);

  const forecastClientRows = useMemo(
    () => clientBillingRowsForActiveEvents(activeForecastClientRows),
    [activeForecastClientRows],
  );

  const archivePeriodClientRows = useMemo(
    () => buildClientRowsForPeriod(archiveMonth),
    [archiveMonth, buildClientRowsForPeriod],
  );

  const { archivedRows: archivedClientRows } = useMemo(
    () => splitClientBillingRows(archivePeriodClientRows),
    [archivePeriodClientRows],
  );

  const archiveClientOptions = useMemo(() => {
    const map = new Map();
    for (const row of archivedClientRows) {
      map.set(String(row.id), row.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [archivedClientRows]);

  const archiveRows = useMemo(
    () => archivedClientRows.filter((row) => archiveClientId === 'all' || String(row.id) === archiveClientId),
    [archiveClientId, archivedClientRows],
  );

  const allPaymentStaffEntries = useMemo(() => financeServices
    .flatMap((event) => billableAssignments(event).map((assignment) => ({ ...assignment, event })))
    .sort((a, b) => assignmentWorkDateTimestamp(a) - assignmentWorkDateTimestamp(b)),
  [financeServices]);

  const selectedPaymentStaffEntries = useMemo(() => allPaymentStaffEntries
    .filter((assignment) => paymentMonthMatches(assignment, selectedMonth)),
  [allPaymentStaffEntries, selectedMonth]);

  const forecastPaymentStaffEntries = useMemo(() => forecastServices
    .flatMap((event) => billableAssignments(event).map((assignment) => ({ ...assignment, event })))
    .filter((assignment) => paymentMonthMatches(assignment, selectedMonth)),
  [forecastServices, selectedMonth]);

  const staffEventOptions = useMemo(
    () => [...new Map(selectedPaymentStaffEntries.map((assignment) => [String(assignment.event.id), assignment.event])).values()]
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      .map((event) => ({
        id: String(event.id),
        label: `${event.date ? date.format(new Date(event.date)) : '-'} · ${event.name}`,
      })),
    [selectedPaymentStaffEntries],
  );

  const staffCollaboratorOptions = useMemo(() => {
    const map = new Map();
    for (const assignment of selectedPaymentStaffEntries) {
      if (!assignment.collaboratorId || map.has(String(assignment.collaboratorId))) continue;
      map.set(String(assignment.collaboratorId), {
        id: String(assignment.collaboratorId),
        label: `${assignment.collaborator?.shortName || assignment.collaborator?.name || '-'} | ${assignment.collaborator?.nif || '-'}`,
      });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [selectedPaymentStaffEntries]);

  useEffect(() => {
    const area = searchParams.get('area');
    const assignmentId = searchParams.get('assignmentId');
    if (area !== 'staff' || !assignmentId) return;

    const target = allPaymentStaffEntries.find((assignment) => String(assignment.id) === String(assignmentId));
    if (!target) return;

    const timing = staffPaymentTiming(target);
    const fallbackDate = assignmentWorkDateValue(target) || target.event?.date;
    const targetMonth = timing.paymentMonth
      || timing.defaultMonth
      || (fallbackDate ? monthKey(fallbackDate) : '');
    if (targetMonth && targetMonth !== selectedMonth) setSelectedMonth(targetMonth);
    setPendingStaffAssignmentLink(String(target.id));
  }, [allPaymentStaffEntries, searchParams, selectedMonth]);

  useEffect(() => {
    if (!pendingStaffAssignmentLink) return;
    const target = selectedPaymentStaffEntries.find((assignment) => String(assignment.id) === pendingStaffAssignmentLink);
    if (!target) return;

    const timing = staffPaymentTiming(target);
    const linkState = staffPaymentLinkSelection(target, {
      paymentMonth: timing.paymentMonth || timing.defaultMonth || selectedMonth,
      workDate: assignmentWorkDateInputValue(target),
    });
    if (!linkState) return;

    setActiveArea('staff');
    setSelectedMonth(linkState.selectedMonth || selectedMonth);
    setStaffFilters(linkState.staffFilters);
    setStaffPaymentTab(linkState.staffPaymentTab);
    setSelectedStaffPaymentIds(linkState.selectedStaffPaymentIds);
    setPendingStaffAssignmentLink('');

    const nextParams = new window.URLSearchParams(searchParams);
    nextParams.delete('assignmentId');
    setSearchParams(nextParams, { replace: true });
  }, [pendingStaffAssignmentLink, searchParams, selectedMonth, selectedPaymentStaffEntries, setSearchParams]);

  useEffect(() => {
    if (staffFilters.eventId !== 'all' && !staffEventOptions.some((event) => event.id === staffFilters.eventId)) {
      setStaffFilters((prev) => ({ ...prev, eventId: 'all' }));
    }
  }, [staffEventOptions, staffFilters.eventId]);

  useEffect(() => {
    if (archiveClientId !== 'all' && !archiveClientOptions.some((client) => client.id === archiveClientId)) {
      setArchiveClientId('all');
    }
  }, [archiveClientId, archiveClientOptions]);

  useEffect(() => {
    if (staffFilters.collaboratorId !== 'all' && !staffCollaboratorOptions.some((collaborator) => collaborator.id === staffFilters.collaboratorId)) {
      setStaffFilters((prev) => ({ ...prev, collaboratorId: 'all' }));
    }
  }, [staffCollaboratorOptions, staffFilters.collaboratorId]);

  useEffect(() => {
    if (staffFilters.date && !selectedPaymentStaffEntries.some((assignment) => assignmentWorkDateInputValue(assignment) === staffFilters.date)) {
      setStaffFilters((prev) => ({ ...prev, date: '' }));
    }
  }, [selectedPaymentStaffEntries, staffFilters.date]);

  const filteredStaffEntries = useMemo(() => selectedPaymentStaffEntries
    .filter((assignment) => {
      if (staffFilters.eventId !== 'all' && String(assignment.event.id) !== staffFilters.eventId) return false;
      if (staffFilters.date && assignmentWorkDateInputValue(assignment) !== staffFilters.date) return false;
      if (staffFilters.collaboratorId !== 'all' && String(assignment.collaboratorId) !== staffFilters.collaboratorId) return false;
      return true;
    }),
  [selectedPaymentStaffEntries, staffFilters]);

  const currentStaffCollaboratorCount = useMemo(() => {
    const ids = new Set();
    for (const assignment of selectedPaymentStaffEntries) {
      if (assignment.collaboratorId) ids.add(String(assignment.collaboratorId));
    }
    return ids.size;
  }, [selectedPaymentStaffEntries]);

  const staffByCollaborator = useMemo(() => {
    const map = new Map();
    for (const assignment of filteredStaffEntries) {
      const key = Number(assignment.collaboratorId);
      const current = map.get(key) || {
        id: key,
        name: assignment.collaborator?.shortName || assignment.collaborator?.name || '-',
        nif: assignment.collaborator?.nif || '-',
        hours: 0,
        total: 0,
        unpaid: 0,
        events: 0,
      };
      current.hours += assignmentHours(assignment);
      current.total += assignmentStaffCostTotal(assignment);
      current.unpaid += assignment.paymentStatus === 'paid' ? 0 : assignmentOutstandingPay(assignment);
      current.events += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filteredStaffEntries]);

  const staffByMonth = useMemo(() => {
    const map = new Map();
    for (const event of financeServices) {
      if (staffFilters.eventId !== 'all' && String(event.id) !== staffFilters.eventId) continue;
      for (const assignment of billableAssignments(event)) {
        const assignmentWithEvent = { ...assignment, event };
        if (staffFilters.date && assignmentWorkDateInputValue(assignmentWithEvent) !== staffFilters.date) continue;
        if (staffFilters.collaboratorId !== 'all' && String(assignment.collaboratorId) !== staffFilters.collaboratorId) continue;
        const total = assignmentStaffCostTotal(assignmentWithEvent);
        if (total <= 0) continue;
        const key = staffPaymentTiming(assignmentWithEvent).paymentMonth || monthKey(assignmentWorkDateValue(assignmentWithEvent));
        map.set(key, (map.get(key) || 0) + total);
      }
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 8);
  }, [financeServices, staffFilters]);

  const currentMonthUnpaidAssignments = useMemo(() => selectedPaymentStaffEntries
    .filter((assignment) => assignment.paymentStatus !== 'paid')
    .sort((a, b) => assignmentWorkDateTimestamp(a) - assignmentWorkDateTimestamp(b)), [selectedPaymentStaffEntries]);

  const filteredAssignments = useMemo(() => filteredStaffEntries
    .sort((a, b) => assignmentWorkDateTimestamp(a) - assignmentWorkDateTimestamp(b)),
  [filteredStaffEntries]);

  const filteredPendingAssignments = useMemo(
    () => filteredAssignments.filter((assignment) => assignment.paymentStatus !== 'paid'),
    [filteredAssignments],
  );

  const filteredPaidAssignments = useMemo(
    () => filteredAssignments.filter((assignment) => assignment.paymentStatus === 'paid'),
    [filteredAssignments],
  );

  const visibleStaffPayments = staffPaymentTab === 'paid' ? filteredPaidAssignments : filteredPendingAssignments;
  const visibleStaffPaymentIds = useMemo(
    () => visibleStaffPayments.map((assignment) => String(assignment.id)),
    [visibleStaffPayments],
  );
  const selectedStaffPaymentIdSet = useMemo(
    () => new Set(selectedStaffPaymentIds),
    [selectedStaffPaymentIds],
  );
  const allVisibleStaffPaymentsSelected = visibleStaffPaymentIds.length > 0
    && visibleStaffPaymentIds.every((id) => selectedStaffPaymentIdSet.has(id));
  const selectedVisibleStaffPayments = useMemo(
    () => visibleStaffPayments.filter((assignment) => selectedStaffPaymentIdSet.has(String(assignment.id))),
    [selectedStaffPaymentIdSet, visibleStaffPayments],
  );

  useEffect(() => {
    setSelectedStaffPaymentIds((prev) => prev.filter((id) => visibleStaffPaymentIds.includes(id)));
  }, [visibleStaffPaymentIds]);

  const vatByCategory = useMemo(() => {
    const map = new Map();
    for (const expense of currentMonthExpenses) {
      map.set(expense.category, (map.get(expense.category) || 0) + num(expense.vatAmount));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [currentMonthExpenses]);

  const expenseByCategory = useMemo(() => {
    const map = new Map();
    for (const expense of currentMonthExpenses) {
      map.set(expense.category, (map.get(expense.category) || 0) + num(expense.amount));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [currentMonthExpenses]);

  const treasury = useMemo(() => {
    const invoiceReceivable = invoices
      .filter((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled')
      .reduce((sum, invoice) => sum + num(invoice.total), 0);
    const pendingBilling = billingGroups.reduce((sum, group) => sum + num(group.total), 0);
    const payable = financeServices.reduce((sum, event) => sum + billableAssignments(event)
      .filter((assignment) => assignment.paymentStatus !== 'paid')
      .reduce((assignmentSum, assignment) => assignmentSum + assignmentOutstandingPay(assignment), 0), 0);
    const bank = num(bankBalance || latestBankBalance?.amount);
    return {
      bank,
      receivable: invoiceReceivable + pendingBilling,
      payable,
      projected: bank + invoiceReceivable + pendingBilling - payable,
    };
  }, [invoices, billingGroups, financeServices, bankBalance, latestBankBalance]);

  const alerts = useMemo(() => {
    const overdueInvoices = invoices.filter((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled' && dayDiffFromToday(invoice.dueDate) > 0);
    const overdue30 = overdueInvoices.filter((invoice) => dayDiffFromToday(invoice.dueDate) >= 30);
    const unpaidStaff = currentMonthUnpaidAssignments.reduce((sum, assignment) => sum + assignmentOutstandingPay(assignment), 0);
    return [
      {
        tone: overdue30.length ? 'danger' : overdueInvoices.length ? 'warning' : 'success',
        label: overdue30.length ? 'Faturas vencidas há 30+ dias' : overdueInvoices.length ? 'Faturas vencidas' : 'Faturas sem atraso crítico',
        value: overdueInvoices.length ? `${overdueInvoices.length} fatura(s)` : 'OK',
      },
      {
        tone: currentBillingGroups.length ? 'warning' : 'success',
        label: 'Pronto / pendente faturar',
        value: money.format(currentBillingGroups.reduce((sum, group) => sum + group.total, 0)),
      },
      {
        tone: unpaidStaff > 0 ? 'warning' : 'success',
        label: 'Staff por pagar este mês',
        value: money.format(unpaidStaff),
      },
      {
        tone: dashboard.vatEstimated > 0 ? 'info' : 'success',
        label: 'IVA estimado',
        value: money.format(dashboard.vatEstimated),
      },
    ];
  }, [invoices, currentMonthUnpaidAssignments, currentBillingGroups, dashboard.vatEstimated]);

  async function updatePaymentStatus(
    assignment,
    paymentStatus,
    paymentDate = assignment.paymentDate || null,
    paymentAdjustment = assignment.paymentAdjustment || 0,
    paymentDeferredMonth = assignment.paymentDeferredMonth || null,
  ) {
    setUpdatingAssignmentId(assignment.id);
    try {
      await api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildStaffPaymentStatusPayload({
          paymentStatus,
          paymentDate,
          paymentAdjustment,
          paymentDeferredMonth,
        }, todayIso())),
      });
      reload();
    } finally {
      setUpdatingAssignmentId(null);
    }
  }

  async function updatePaymentDeferredMonth(assignment, paymentDeferredMonth) {
    setUpdatingAssignmentId(assignment.id);
    try {
      await api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ paymentDeferredMonth }),
      });
      reload();
    } finally {
      setUpdatingAssignmentId(null);
    }
  }

  async function deferPaymentToNextMonth(assignment) {
    const timing = staffPaymentTiming(assignment);
    const targetMonth = nextStaffPaymentMonth(timing.paymentMonth || timing.defaultMonth);
    if (!targetMonth) return;
    await updatePaymentDeferredMonth(assignment, targetMonth);
  }

  async function resetPaymentMonth(assignment) {
    await updatePaymentDeferredMonth(assignment, null);
  }

  function paymentDraftFor(assignment) {
    const current = staffPaymentDrafts[assignment.id] || {};
    return {
      paymentStatus: current.paymentStatus || assignment.paymentStatus || 'unpaid',
      paymentDate: current.paymentDate ?? (assignment.paymentDate ? String(assignment.paymentDate).slice(0, 10) : ''),
      paymentAdjustment: current.paymentAdjustment ?? adjustmentInputValue(assignment.paymentAdjustment),
    };
  }

  function updatePaymentDraft(assignmentId, patch) {
    setStaffPaymentDrafts((prev) => ({
      ...prev,
      [assignmentId]: { ...(prev[assignmentId] || {}), ...patch },
    }));
  }

  async function confirmMoveToPaid(assignment) {
    const draft = paymentDraftFor(assignment);
    setUpdatingAssignmentId(assignment.id);
    try {
      await api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildMoveToPaidPayload({
          paymentDate: draft.paymentDate,
          paymentAdjustment: draft.paymentAdjustment,
          paymentDeferredMonth: assignment.paymentDeferredMonth || null,
        }, todayIso())),
      });
      setStaffPaymentDrafts((prev) => {
        const next = { ...prev };
        delete next[assignment.id];
        return next;
      });
      setSelectedStaffPaymentIds((prev) => prev.filter((id) => id !== String(assignment.id)));
      reload();
    } finally {
      setUpdatingAssignmentId(null);
    }
  }

  function toggleStaffPaymentSelection(assignmentId, checked) {
    const id = String(assignmentId);
    setSelectedStaffPaymentIds((prev) => {
      const current = new Set(prev);
      if (checked) current.add(id);
      else current.delete(id);
      return [...current];
    });
  }

  function toggleAllVisibleStaffPayments(checked) {
    setSelectedStaffPaymentIds(checked ? visibleStaffPaymentIds : []);
  }

  async function applyBulkPaymentStatus() {
    if (!selectedVisibleStaffPayments.length || bulkUpdatingPayments) return;
    const paymentDate = bulkPaymentStatus === 'paid' ? (bulkPaymentDate || todayIso()) : '';
    setBulkUpdatingPayments(true);
    try {
      await Promise.all(selectedVisibleStaffPayments.map((assignment) => {
        const draft = paymentDraftFor(assignment);
        return api(`/assignments/${assignment.id}`, {
          method: 'PUT',
          body: JSON.stringify(buildStaffPaymentStatusPayload({
            paymentStatus: bulkPaymentStatus,
            paymentDate,
            paymentAdjustment: draft.paymentAdjustment,
            paymentDeferredMonth: assignment.paymentDeferredMonth || null,
          }, todayIso())),
        });
      }));
      setStaffPaymentDrafts((prev) => {
        const next = { ...prev };
        for (const assignment of selectedVisibleStaffPayments) delete next[assignment.id];
        return next;
      });
      setSelectedStaffPaymentIds([]);
      reload();
    } finally {
      setBulkUpdatingPayments(false);
    }
  }

  async function savePaymentAdjustment(assignment) {
    const draft = paymentDraftFor(assignment);
    const parsed = decimalValue(draft.paymentAdjustment) || 0;
    setUpdatingAssignmentId(assignment.id);
    try {
      await api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ paymentAdjustment: parsed }),
      });
      updatePaymentDraft(assignment.id, { paymentAdjustment: adjustmentInputValue(parsed) });
      reload();
    } finally {
      setUpdatingAssignmentId(null);
    }
  }

  function openPaymentNotes(assignment) {
    setPaymentNotesAssignment(assignment);
    setPaymentNotesDraft(paymentNotesOverrides[assignment.id] ?? assignment.paymentNotes ?? '');
  }

  function closePaymentNotes() {
    if (savingPaymentNotes) return;
    setPaymentNotesAssignment(null);
    setPaymentNotesDraft('');
  }

  async function savePaymentNotes() {
    if (!paymentNotesAssignment) return;
    setSavingPaymentNotes(true);
    try {
      const paymentNotes = normalizePaymentNotes(paymentNotesDraft);
      await api(`/assignments/${paymentNotesAssignment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ paymentNotes }),
      });
      setPaymentNotesOverrides((prev) => ({ ...prev, [paymentNotesAssignment.id]: paymentNotes || '' }));
      setPaymentNotesAssignment(null);
      setPaymentNotesDraft('');
      reload();
    } finally {
      setSavingPaymentNotes(false);
    }
  }

  async function updateEventBillingStatus(eventIds, billingStatus, updateKey = eventIds) {
    const ids = (Array.isArray(eventIds) ? eventIds : [eventIds])
      .map(Number)
      .filter((id) => Number.isFinite(id));
    if (!ids.length) return;

    setUpdatingEventId(updateKey);
    try {
      const billingPaymentDate = billingStatus === 'paid' ? todayIso() : null;
      await Promise.all(ids.map((eventId) => api(`/services/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ billingStatus, billingPaymentDate }),
      })));
      reload();
    } finally {
      setUpdatingEventId(null);
    }
  }

  async function updateInvoiceStatus(invoice, status) {
    setUpdatingInvoiceId(invoice.id);
    try {
      await api(`/invoices/${invoice.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      const eventIds = parseInvoiceEventIds(invoice);
      const nextBillingStatus = status === 'paid' ? 'paid' : status === 'cancelled' ? 'pending' : 'invoiced';
      const billingPaymentDate = status === 'paid' ? todayIso() : null;
      await Promise.all(eventIds.map((eventId) => api(`/services/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ billingStatus: nextBillingStatus, billingPaymentDate }),
      })));
      reloadInvoices();
      reload();
    } finally {
      setUpdatingInvoiceId(null);
    }
  }

  async function submitExpense(event) {
    event.preventDefault();
    setSavingExpense(true);
    setExpenseError('');
    try {
      if (!expenseForm.amount) throw new Error('Indica o valor da despesa.');
      await api('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          category: expenseForm.category,
          amount: Number(expenseForm.amount || 0),
          vatAmount: Number(expenseForm.vatAmount || 0),
          supplier: expenseForm.supplier || null,
          description: expenseForm.description || null,
          referenceId: expenseForm.referenceId ? Number(expenseForm.referenceId) : null,
          date: expenseForm.date,
          sentToAccountant: Boolean(expenseForm.sentToAccountant),
          documentName: expenseForm.documentName || null,
          documentData: expenseForm.documentData || null,
        }),
      });
      setExpenseForm(emptyExpense());
      reloadTransactions();
    } catch (err) {
      setExpenseError(err.message);
    } finally {
      setSavingExpense(false);
    }
  }

  async function onExpenseFileSelected(file) {
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setExpenseForm((prev) => ({ ...prev, documentName: file.name, documentData: dataUrl }));
  }

  async function updateExpenseSent(expense, sentToAccountant) {
    await api(`/transactions/${expense.id}`, {
      method: 'PUT',
      body: JSON.stringify({ sentToAccountant }),
    });
    reloadTransactions();
  }

  async function saveBankBalance() {
    setSavingBankBalance(true);
    try {
      const payload = {
        type: 'treasury_balance',
        category: 'bank_balance',
        amount: Number(bankBalance || 0),
        vatAmount: 0,
        supplier: 'Conta bancária',
        description: 'Saldo da conta bancária',
        date: new Date().toISOString(),
        sentToAccountant: false,
      };
      if (latestBankBalance) {
        await api(`/transactions/${latestBankBalance.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/transactions', { method: 'POST', body: JSON.stringify(payload) });
      }
      reloadTransactions();
    } finally {
      setSavingBankBalance(false);
    }
  }

  const forecastFinanceSummary = {
    events: currentForecastEventRows.length,
    revenue: currentForecastEventRows.reduce((sum, event) => sum + event.financial.revenue, 0),
    staff: currentForecastEventRows.reduce((sum, event) => sum + event.financial.staff, 0),
    billing: currentForecastBillingGroups.reduce((sum, group) => sum + group.total, 0),
    staffPayments: forecastPaymentStaffEntries.reduce((sum, assignment) => sum + assignmentOutstandingPay(assignment), 0),
  };

  const readyFinanceSummary = {
    events: currentEventRows.length,
    revenue: currentEventRows.reduce((sum, event) => sum + event.financial.revenue, 0),
    staff: currentEventRows.reduce((sum, event) => sum + event.financial.staff, 0),
    billing: currentBillingGroups.reduce((sum, group) => sum + group.total, 0),
    staffPayments: currentMonthUnpaidAssignments.reduce((sum, assignment) => sum + assignmentOutstandingPay(assignment), 0),
  };

  const forecastStaffPreviewRows = topItems(
    [...forecastPaymentStaffEntries].sort((a, b) => assignmentWorkDateTimestamp(a) - assignmentWorkDateTimestamp(b)),
    5,
  );

  const forecastClientPreviewRows = topItems(
    forecastClientRows.filter((client) => client.totalOpen > 0 || client.pendingBilling > 0),
    5,
  );

  const dashboardItems = [
    { label: 'Faturação emitida', value: money.format(dashboard.issued), detail: `${monthLabel(selectedMonth)} · finalizados` },
    { label: 'Faturação recebida', value: money.format(dashboard.received), detail: 'Recebido / sinalizado validado' },
    { label: 'Custos com staff', value: money.format(dashboard.staff), detail: `${currentStaffCollaboratorCount} colaborador(es)` },
  ];

  const eventOptions = useMemo(
    () => [...services]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .map((event) => ({
        id: event.id,
        label: `${event.date ? date.format(new Date(event.date)) : '-'} · ${event.name}`,
      })),
    [services],
  );

  return (
    <div className="page finance-page">
      <div className="page-title-row finance-title-row">
        <div>
          <h1>Financeiro</h1>
          <p>Gestão financeira ligada aos eventos, faturação, staff, despesas, IVA e tesouraria.</p>
        </div>
        <div className="finance-month-control">
          <label>
            Mês
            <select
              value={selectedMonthNumber || '01'}
              onChange={(event) => setSelectedMonth(`${selectedYear || new Date().getFullYear()}-${event.target.value}`)}
            >
              {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
          </label>
          <label>
            Ano
            <select
              value={selectedYear || String(new Date().getFullYear())}
              onChange={(event) => setSelectedMonth(`${event.target.value}-${selectedMonthNumber || '01'}`)}
            >
              {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <button className="secondary-button" type="button" onClick={() => setSelectedMonth(monthInputValue())}>
            Atual
          </button>
        </div>
      </div>

      <Stats items={dashboardItems} />

      {error ? <p className="notice">{error}</p> : null}
      {loading ? <p className="muted">A carregar...</p> : null}

      <div className="service-tabs budget-tabs finance-tabs">
        {AREA_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`service-tab ${activeArea === tab.id ? 'service-tab--active' : ''}`}
            onClick={() => selectArea(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeArea === 'overview' ? (
        <div className="finance-readiness-grid">
          <section className="finance-readiness-panel finance-readiness-panel--forecast">
            <header>
              <span className="finance-readiness-icon"><Hourglass size={20} /></span>
              <div>
                <small>Previsão</small>
                <h2>Ainda não validado</h2>
              </div>
              <Badge tone="warning">Não processável</Badge>
            </header>
            <div className="finance-readiness-metrics">
              <div><span>Valor previsto</span><strong>{money.format(forecastFinanceSummary.revenue)}</strong></div>
              <div><span>Staff previsto</span><strong>{money.format(forecastFinanceSummary.staff)}</strong></div>
              <div><span>Eventos</span><strong>{forecastFinanceSummary.events}</strong></div>
              <div><span>Por faturar previsto</span><strong>{money.format(forecastFinanceSummary.billing)}</strong></div>
            </div>
            <div className="finance-readiness-list">
              {topItems([...currentForecastEventRows].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()), 4).map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.name}</strong>
                    <small>{event.client?.name || '-'} · {event.date ? date.format(new Date(event.date)) : '-'}</small>
                  </div>
                  <span>{money.format(event.financial.revenue)}</span>
                </article>
              ))}
              {!currentForecastEventRows.length ? <p className="muted">Sem eventos em previsão neste período.</p> : null}
            </div>
          </section>

          <section className="finance-readiness-panel finance-readiness-panel--ready">
            <header>
              <span className="finance-readiness-icon"><CheckCircle2 size={20} /></span>
              <div>
                <small>Pronto para financeiro</small>
                <h2>Validado / real</h2>
              </div>
              <Badge tone="success">Processável</Badge>
            </header>
            <div className="finance-readiness-metrics">
              <div><span>Valor validado</span><strong>{money.format(readyFinanceSummary.revenue)}</strong></div>
              <div><span>Pronto a faturar</span><strong>{money.format(readyFinanceSummary.billing)}</strong></div>
              <div><span>Staff a pagar</span><strong>{money.format(readyFinanceSummary.staffPayments)}</strong></div>
              <div><span>Eventos</span><strong>{readyFinanceSummary.events}</strong></div>
            </div>
            <div className="finance-readiness-list">
              {topItems([...currentEventRows].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()), 4).map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.name}</strong>
                    <small>{event.client?.name || '-'} · {event.date ? date.format(new Date(event.date)) : '-'}</small>
                  </div>
                  <span>{money.format(event.financial.revenue)}</span>
                </article>
              ))}
              {!currentEventRows.length ? <p className="muted">Sem eventos finalizados neste período.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeArea === 'overview' ? (
        <>
          <div className="finance-alert-grid">
            {alerts.map((alert) => (
              <article key={alert.label} className={`finance-alert-card finance-alert-card--${alert.tone}`}>
                <span>{alert.label}</span>
                <strong>{alert.value}</strong>
              </article>
            ))}
          </div>

          <div className="finance-grid finance-grid--two">
            <Card title="Prioridades Financeiras">
              <div className="finance-action-list">
                {topItems(currentBillingGroups, 4).map((group) => (
                  <article key={group.key} className="finance-action-item">
                    <ReceiptText size={18} />
                    <div>
                      <strong>{group.label}</strong>
                      <small>{group.events.length} evento(s) · emissão {date.format(group.issueDate)}</small>
                    </div>
                    <strong>{money.format(group.total)}</strong>
                  </article>
                ))}
                {topItems(clientRows.filter((client) => client.overdueDays > 0), 3).map((client) => (
                  <article key={`client-${client.rowId}`} className="finance-action-item finance-action-item--danger">
                    <FileText size={18} />
                    <div>
                      <strong>{client.name}</strong>
                      <small>Fatura vencida há {client.overdueDays} dia(s)</small>
                    </div>
                    <strong>{money.format(client.totalOpen)}</strong>
                  </article>
                ))}
                {!currentBillingGroups.length && !clientRows.some((client) => client.overdueDays > 0) ? (
                  <p className="muted">Sem alertas financeiros críticos neste mês.</p>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="finance-grid finance-grid--two">
            <Card title="Clientes com Valor em Aberto">
              <div className="finance-list">
                {topItems(clientRows.filter((client) => client.totalOpen > 0), 6).map((client) => (
                  <article key={client.rowId} className="finance-list-item finance-list-item--wide">
                    <div>
                      <strong>{client.name}</strong>
                      <small>{client.invoicesCount} fatura(s) em aberto · {BILLING_METHOD_LABELS[client.billingMethod] || '-'}</small>
                    </div>
                    <span>{money.format(client.pendingBilling)} por faturar</span>
                    <strong>{money.format(client.totalOpen)}</strong>
                  </article>
                ))}
                {!clientRows.some((client) => client.totalOpen > 0) ? <p className="muted">Sem valores em aberto.</p> : null}
              </div>
            </Card>

            <Card title="Eventos com Melhor Margem">
              <div className="finance-list">
                {topItems([...currentEventRows].sort((a, b) => b.financial.margin - a.financial.margin), 6).map((event) => (
                  <article key={event.id} className="finance-list-item finance-list-item--wide">
                    <div>
                      <strong>{event.name}</strong>
                      <small>{event.client?.name || '-'} · {event.date ? date.format(new Date(event.date)) : '-'}</small>
                    </div>
                    <span>{event.financial.marginPct.toFixed(1)}%</span>
                    <strong className={event.financial.margin < 0 ? 'money-negative' : 'money-positive'}>{money.format(event.financial.margin)}</strong>
                  </article>
                ))}
                {!currentEventRows.length ? <p className="muted">Sem eventos neste mês.</p> : null}
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {activeArea === 'clients' ? (
        <Card title="Clientes">
          <div className="finance-readiness-grid finance-readiness-grid--compact">
            <section className="finance-readiness-panel finance-readiness-panel--forecast">
              <header>
                <span className="finance-readiness-icon"><Hourglass size={18} /></span>
                <div>
                  <small>Previsão de faturação</small>
                  <h2>Por validar</h2>
                </div>
                <Badge tone="warning">{forecastClientRows.length} linha(s)</Badge>
              </header>
              <div className="finance-readiness-metrics">
                <div><span>Valor previsto</span><strong>{money.format(forecastFinanceSummary.billing || forecastFinanceSummary.revenue)}</strong></div>
                <div><span>Eventos</span><strong>{forecastFinanceSummary.events}</strong></div>
              </div>
              <div className="finance-readiness-list">
                {forecastClientPreviewRows.map((client) => (
                  <article key={client.rowId}>
                    <div>
                      <strong>{client.name}</strong>
                      <small>{client.billingPeriodLabel || BILLING_METHOD_LABELS[client.billingMethod] || '-'}</small>
                    </div>
                    <span>{money.format(client.totalOpen || client.pendingBilling)}</span>
                  </article>
                ))}
                {!forecastClientPreviewRows.length ? <p className="muted">Sem clientes por validar neste período.</p> : null}
              </div>
            </section>

            <section className="finance-readiness-panel finance-readiness-panel--ready">
              <header>
                <span className="finance-readiness-icon"><ReceiptText size={18} /></span>
                <div>
                  <small>Faturação processável</small>
                  <h2>Eventos finalizados</h2>
                </div>
                <Badge tone="success">{clientRows.length} linha(s)</Badge>
              </header>
              <div className="finance-readiness-metrics">
                <div><span>Pronto a faturar</span><strong>{money.format(readyFinanceSummary.billing)}</strong></div>
                <div><span>Em aberto</span><strong>{money.format(clientRows.reduce((sum, client) => sum + client.totalOpen, 0))}</strong></div>
              </div>
              <p className="muted">A tabela abaixo permite alterar estados apenas para eventos finalizados.</p>
            </section>
          </div>

          <div className="finance-table-heading">
            <div>
              <strong>Pronto a faturar e receber</strong>
              <small>Dados processáveis do período selecionado</small>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Método</th>
                  <th>Faturas em aberto</th>
                  <th>Em dívida</th>
                  <th>Por faturar</th>
                  <th>Evento/Serviço por faturar</th>
                  <th>Próximo vencimento</th>
                  <th>Estado da Fatura</th>
                  <th>Estado Evento/Serviço</th>
                  <th>Alerta</th>
                </tr>
              </thead>
              <tbody>
                {clientRows.map((client) => {
                  const isExpanded = expandedClientId === client.rowId;
                  const groupedEventIds = new Set(
                    client.billingGroups.flatMap((group) => group.events.map((event) => Number(event.id))),
                  );
                  const billingEventIds = billingEventIdsForRow(client);
                  const billingStatus = billingStatusForRow(client);
                  const standaloneServices = client.nonInvoicedServices.filter((event) => !groupedEventIds.has(Number(event.id)));
                  const hasDetails = client.billingGroups.length || client.invoices.length || standaloneServices.length;

                  return (
                    <Fragment key={client.rowId}>
                      <tr
                        className="finance-client-row"
                        onClick={() => setExpandedClientId((current) => (current === client.rowId ? null : client.rowId))}
                      >
                        <td>
                          <div className="finance-client-cell">
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <strong>{client.name}</strong>
                          </div>
                        </td>
                    <td>{BILLING_METHOD_LABELS[client.billingMethod] || '-'}</td>
                    <td>{client.invoicesCount}</td>
                    <td>{money.format(client.totalOpen)}</td>
                    <td>{money.format(client.pendingBilling)}</td>
                    <td>{client.actionableService?.name || '-'}</td>
                    <td>{client.nextDueDate ? date.format(new Date(client.nextDueDate)) : '-'}</td>
                    <td>
                      {client.actionableInvoice ? (
                        <select
                          className={`payment-state payment-state--${client.actionableInvoice.status === 'paid' ? 'paid' : client.actionableInvoice.status === 'issued' ? 'pending' : 'awaiting_data'}`}
                          value={client.actionableInvoice.status || 'issued'}
                          disabled={updatingInvoiceId === client.actionableInvoice.id}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateInvoiceStatus(client.actionableInvoice, event.target.value)}
                        >
                          {INVOICE_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <span className="muted">Sem fatura</span>
                      )}
                    </td>
                    <td>
                      {client.actionableService ? (
                        <select
                          className={`payment-state payment-state--${billingStatus}`}
                          value={billingStatus}
                          disabled={updatingEventId === client.rowId}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateEventBillingStatus(billingEventIds, event.target.value, client.rowId)}
                        >
                          {BILLING_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <span className="muted">Sem serviço</span>
                      )}
                    </td>
                    <td>
                      {client.overdueDays >= 30 ? <Badge tone="danger">Vencida há {client.overdueDays} dias</Badge>
                        : client.overdueDays > 0 ? <Badge tone="warning">Vencida há {client.overdueDays} dias</Badge>
                          : <Badge tone="success">Sem atraso</Badge>}
                    </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="finance-client-detail-row">
                          <td colSpan={10}>
                            <div className="finance-client-detail">
                              {client.billingGroups.map((group) => (
                                <article key={group.key} className="finance-client-billing-group">
                                  <header>
                                    <div>
                                      <small>Período de faturação</small>
                                      <strong>{group.label}</strong>
                                    </div>
                                    <Badge tone="info">{BILLING_METHOD_LABELS[group.method] || group.method}</Badge>
                                    <span>Vencimento: {group.dueDate ? date.format(new Date(group.dueDate)) : '-'}</span>
                                    <strong>{money.format(group.total)}</strong>
                                  </header>
                                  <div className="finance-client-services">
                                    {group.events.map((service) => (
                                      <div key={service.id} className="finance-client-service">
                                        <span>{service.date ? date.format(new Date(service.date)) : '-'}</span>
                                        <strong>{service.name}</strong>
                                        <small>{service.eventType || service.location || '-'}</small>
                                        <span>{money.format(service.financial?.revenue || eventRevenue(service))}</span>
                                      </div>
                                    ))}
                                  </div>
                                </article>
                              ))}

                              {client.invoices.map((invoice) => (
                                <article key={`invoice-${invoice.id}`} className="finance-client-billing-group">
                                  <header>
                                    <div>
                                      <small>Fatura existente</small>
                                      <strong>{invoice.number || invoice.description || `Fatura #${invoice.id}`}</strong>
                                    </div>
                                    <Badge tone={invoiceIsPaid(invoice) ? 'success' : 'warning'}>{statusLabel(INVOICE_STATUS, invoice.status)}</Badge>
                                    <span>Vencimento: {invoice.dueDate ? date.format(new Date(invoice.dueDate)) : '-'}</span>
                                    <strong>{money.format(invoice.total)}</strong>
                                  </header>
                                </article>
                              ))}

                              {standaloneServices.map((service) => (
                                <article key={`service-${service.id}`} className="finance-client-billing-group">
                                  <header>
                                    <div>
                                      <small>Evento/Serviço sem fatura</small>
                                      <strong>{service.name}</strong>
                                    </div>
                                    <Badge tone="warning">{statusLabel(BILLING_STATUS, service.billingStatus || 'pending')}</Badge>
                                    <span>Vencimento: {date.format(new Date(dueDateForService(client, service)))}</span>
                                    <strong>{money.format(service.financial?.receivable || service.financial?.revenue || 0)}</strong>
                                  </header>
                                </article>
                              ))}

                              {!hasDetails ? <p className="muted">Sem serviços ou faturas no período selecionado.</p> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activeArea === 'archive' ? (
        <Card title="Arquivo">
          <div className="finance-month-control finance-archive-filters">
            <label>
              Cliente
              <select value={archiveClientId} onChange={(event) => setArchiveClientId(event.target.value)}>
                <option value="all">Todos os clientes</option>
                {archiveClientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label>
              Mês
              <select
                value={archiveMonthNumber || '00'}
                onChange={(event) => setArchiveMonth(`${archiveYear || new Date().getFullYear()}-${event.target.value}`)}
              >
                {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
              </select>
            </label>
            <label>
              Ano
              <select
                value={archiveYear || String(new Date().getFullYear())}
                onChange={(event) => setArchiveMonth(`${event.target.value}-${archiveMonthNumber || '00'}`)}
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setArchiveClientId('all');
                setArchiveMonth(`${new Date().getFullYear()}-00`);
              }}
            >
              Atual
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Método</th>
                  <th>Eventos/Serviços</th>
                  <th>Valor</th>
                  <th>Data de Pagamento</th>
                  <th>Estado Evento/Serviço</th>
                </tr>
              </thead>
              <tbody>
                {archiveRows.map((client) => {
                  const isExpanded = expandedArchiveClientId === client.rowId;
                  const groupedEventIds = new Set(
                    client.billingGroups.flatMap((group) => group.events.map((event) => Number(event.id))),
                  );
                  const billingEventIds = billingEventIdsForRow(client);
                  const billingStatus = billingStatusForRow(client);
                  const billingValue = billingValueForRow(client);
                  const billingPaymentDate = billingPaymentDateForRow(client);
                  const standaloneServices = client.nonInvoicedServices.filter((event) => !groupedEventIds.has(Number(event.id)));
                  const hasDetails = client.billingGroups.length || client.invoices.length || standaloneServices.length;
                  const updateKey = `archive:${client.rowId}`;

                  return (
                    <Fragment key={client.rowId}>
                      <tr
                        className="finance-client-row"
                        onClick={() => setExpandedArchiveClientId((current) => (current === client.rowId ? null : client.rowId))}
                      >
                        <td>
                          <div className="finance-client-cell">
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <strong>{client.name}</strong>
                          </div>
                        </td>
                        <td>{BILLING_METHOD_LABELS[client.billingMethod] || '-'}</td>
                        <td>{billingEventIds.length}</td>
                        <td>{money.format(billingValue)}</td>
                        <td>{billingPaymentDate ? date.format(billingPaymentDate) : '-'}</td>
                        <td>
                          <select
                            className={`payment-state payment-state--${billingStatus}`}
                            value={billingStatus}
                            disabled={updatingEventId === updateKey}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => updateEventBillingStatus(billingEventIds, event.target.value, updateKey)}
                          >
                            {BILLING_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="finance-client-detail-row">
                          <td colSpan={6}>
                            <div className="finance-client-detail">
                              {client.billingGroups.map((group) => (
                                <article key={group.key} className="finance-client-billing-group">
                                  <header>
                                    <div>
                                      <small>Período de faturação</small>
                                      <strong>{group.label}</strong>
                                    </div>
                                    <Badge tone="success">Pago</Badge>
                                    <span>Vencimento: {group.dueDate ? date.format(new Date(group.dueDate)) : '-'}</span>
                                    <strong>{money.format(group.total)}</strong>
                                  </header>
                                  <div className="finance-client-services">
                                    {group.events.map((service) => (
                                      <div key={service.id} className="finance-client-service">
                                        <span>{service.date ? date.format(new Date(service.date)) : '-'}</span>
                                        <strong>{service.name}</strong>
                                        <small>{service.eventType || service.location || '-'}</small>
                                        <span>{money.format(service.financial?.revenue || eventRevenue(service))}</span>
                                      </div>
                                    ))}
                                  </div>
                                </article>
                              ))}

                              {standaloneServices.map((service) => (
                                <article key={`service-${service.id}`} className="finance-client-billing-group">
                                  <header>
                                    <div>
                                      <small>Evento/Serviço pago</small>
                                      <strong>{service.name}</strong>
                                    </div>
                                    <Badge tone="success">{statusLabel(BILLING_STATUS, service.billingStatus || 'paid')}</Badge>
                                    <span>Vencimento: {date.format(new Date(dueDateForService(client, service)))}</span>
                                    <strong>{money.format(service.financial?.revenue || 0)}</strong>
                                  </header>
                                </article>
                              ))}

                              {!hasDetails ? <p className="muted">Sem serviços arquivados para os filtros selecionados.</p> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!archiveRows.length ? <p className="muted">Sem serviços pagos no arquivo para os filtros selecionados.</p> : null}
          </div>
        </Card>
      ) : null}

      {activeArea === 'staff' ? (
        <div className="finance-grid finance-grid--two">
          <div className="finance-readiness-grid finance-readiness-grid--compact finance-span-2">
            <section className="finance-readiness-panel finance-readiness-panel--forecast">
              <header>
                <span className="finance-readiness-icon"><Hourglass size={18} /></span>
                <div>
                  <small>Previsão Staff</small>
                  <h2>Não processável</h2>
                </div>
                <Badge tone="warning">{forecastPaymentStaffEntries.length} registo(s)</Badge>
              </header>
              <div className="finance-readiness-metrics">
                <div><span>Total previsto</span><strong>{money.format(forecastFinanceSummary.staffPayments)}</strong></div>
                <div><span>Eventos</span><strong>{forecastFinanceSummary.events}</strong></div>
              </div>
              <div className="finance-readiness-list">
                {forecastStaffPreviewRows.map((assignment) => (
                  <article key={assignment.id}>
                    <div>
                      <strong>{assignment.collaborator?.shortName || assignment.collaborator?.name || '-'}</strong>
                      <small>{assignment.event?.name || '-'} · {assignmentWorkDateValue(assignment) ? date.format(new Date(assignmentWorkDateValue(assignment))) : '-'}</small>
                    </div>
                    <span>{money.format(assignmentOutstandingPay(assignment))}</span>
                  </article>
                ))}
                {!forecastStaffPreviewRows.length ? <p className="muted">Sem pagamentos previstos por validar neste período.</p> : null}
              </div>
            </section>

            <section className="finance-readiness-panel finance-readiness-panel--ready">
              <header>
                <span className="finance-readiness-icon"><CheckCircle2 size={18} /></span>
                <div>
                  <small>Pagamentos prontos</small>
                  <h2>Validado</h2>
                </div>
                <Badge tone="success">{selectedPaymentStaffEntries.length} registo(s)</Badge>
              </header>
              <div className="finance-readiness-metrics">
                <div><span>A pagar</span><strong>{money.format(readyFinanceSummary.staffPayments)}</strong></div>
                <div><span>Colaboradores</span><strong>{currentStaffCollaboratorCount}</strong></div>
              </div>
              <p className="muted">Só estes registos entram na tabela de pagamentos e nas ações em massa.</p>
            </section>
          </div>

          <Card title="Filtros de Staff" className="finance-span-2">
            <div className="finance-filter-grid">
              <label>Evento/Serviço
                <select value={staffFilters.eventId} onChange={(event) => setStaffFilters((prev) => ({ ...prev, eventId: event.target.value }))}>
                  <option value="all">Todos os eventos/serviços</option>
                  {staffEventOptions.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
                </select>
              </label>
              <label>Colaborador
                <select value={staffFilters.collaboratorId} onChange={(event) => setStaffFilters((prev) => ({ ...prev, collaboratorId: event.target.value }))}>
                  <option value="all">Todos os colaboradores</option>
                  {staffCollaboratorOptions.map((collaborator) => <option key={collaborator.id} value={collaborator.id}>{collaborator.label}</option>)}
                </select>
              </label>
              <label>Data
                <input
                  type="date"
                  value={staffFilters.date}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setStaffFilters((prev) => ({ ...prev, date: nextDate }));
                    if (nextDate) setSelectedMonth(nextDate.slice(0, 7));
                  }}
                />
              </label>
              <button className="secondary-button" type="button" onClick={() => setStaffFilters({ eventId: 'all', collaboratorId: 'all', date: '' })}>
                Limpar filtros
              </button>
            </div>
          </Card>

          <Card title="Custos por Colaborador">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>NIF</th>
                    <th>Serviços</th>
                    <th>Horas</th>
                    <th>Total</th>
                    <th>Por pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {staffByCollaborator.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.nif}</td>
                      <td>{row.events}</td>
                      <td>{durationHours(row.hours)}</td>
                      <td>{money.format(row.total)}</td>
                      <td>{money.format(row.unpaid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!staffByCollaborator.length ? <p className="muted">Sem custos de staff para os filtros selecionados.</p> : null}
            </div>
          </Card>

          <Card title="Evolução Mensal Staff">
            <div className="finance-month-list">
              {staffByMonth.map(([month, total]) => (
                <div key={month}><span>{monthLabel(month)}</span><strong>{money.format(total)}</strong></div>
              ))}
              {!staffByMonth.length ? <p className="muted">Sem histórico de custos.</p> : null}
            </div>
          </Card>

          <Card title="Pagamentos de Staff" className="finance-span-2">
            <div className="service-tabs budget-tabs finance-tabs">
              <button
                type="button"
                className={`service-tab ${staffPaymentTab === 'unpaid' ? 'service-tab--active' : ''}`}
                onClick={() => setStaffPaymentTab('unpaid')}
              >
                Colaboradores por pagar ({filteredPendingAssignments.length})
              </button>
              <button
                type="button"
                className={`service-tab ${staffPaymentTab === 'paid' ? 'service-tab--active' : ''}`}
                onClick={() => setStaffPaymentTab('paid')}
              >
                Colaboradores pagos ({filteredPaidAssignments.length})
              </button>
            </div>
            <div className="finance-bulk-toolbar">
              <label className="finance-selection-check">
                <input
                  type="checkbox"
                  checked={allVisibleStaffPaymentsSelected}
                  disabled={!visibleStaffPaymentIds.length || bulkUpdatingPayments}
                  onChange={(event) => toggleAllVisibleStaffPayments(event.target.checked)}
                />
                <span>Selecionar todos</span>
              </label>
              <span className="muted">{selectedVisibleStaffPayments.length} selecionado(s)</span>
              <select
                className="form-control finance-bulk-status"
                value={bulkPaymentStatus}
                disabled={bulkUpdatingPayments}
                onChange={(event) => {
                  setBulkPaymentStatus(event.target.value);
                  if (event.target.value === 'paid' && !bulkPaymentDate) setBulkPaymentDate(todayIso());
                }}
              >
                {PAYMENT_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input
                className="form-control finance-bulk-date"
                type="date"
                value={bulkPaymentDate}
                disabled={bulkPaymentStatus !== 'paid' || bulkUpdatingPayments}
                onChange={(event) => setBulkPaymentDate(event.target.value)}
              />
              <button
                type="button"
                className="command-button"
                disabled={!selectedVisibleStaffPayments.length || bulkUpdatingPayments}
                onClick={applyBulkPaymentStatus}
              >
                {bulkUpdatingPayments ? 'A aplicar...' : 'Aplicar alteração'}
              </button>
              {selectedVisibleStaffPayments.length ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={bulkUpdatingPayments}
                  onClick={() => setSelectedStaffPaymentIds([])}
                >
                  Limpar seleção
                </button>
              ) : null}
            </div>
            <div className="table-wrap">
              <table className="finance-staff-payment-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos os pagamentos visíveis"
                        checked={allVisibleStaffPaymentsSelected}
                        disabled={!visibleStaffPaymentIds.length || bulkUpdatingPayments}
                        onChange={(event) => toggleAllVisibleStaffPayments(event.target.checked)}
                      />
                    </th>
                    <th>Colaborador</th>
                    <th>Evento</th>
                    <th>Data</th>
                    <th>Horas</th>
                    <th>Valor/h</th>
                    <th>Ajustes</th>
                    <th>Adiant.</th>
                    <th>Carro</th>
                    <th>A pagar</th>
                    <th>Vencimento</th>
                    <th>Estado</th>
                    <th>Data pagamento</th>
                    {staffPaymentTab === 'unpaid' ? <th>Ação</th> : null}
                  </tr>
                </thead>
                <tbody>
              {visibleStaffPayments.map((assignment) => (
                    (() => {
                      const draft = paymentDraftFor(assignment);
                      const paymentNotes = paymentNotesOverrides[assignment.id] ?? assignment.paymentNotes ?? '';
                      const timing = staffPaymentTiming(assignment);
                      const rowSelected = selectedStaffPaymentIdSet.has(String(assignment.id));
                      const advances = assignmentAdvances(assignment);
                      const advanceTotal = staffAdvancesTotal(advances);
                      const carAdvanceTotal = staffCarAdvancesTotal(advances);
                      const grossTotal = assignmentPayWithVat({ ...assignment, paymentAdjustment: draft.paymentAdjustment });
                      const outstandingTotal = staffPaymentRemaining(grossTotal, advances);
                      const salaryAdvanceNotes = advances.filter((advance) => !advance.car).map((advance) => advance.note).filter(Boolean);
                      const carAdvanceNotes = advances.filter((advance) => advance.car).map((advance) => advance.note).filter(Boolean);
                      return (
                    <tr key={assignment.id} className={`${assignment.collaborator?.includeVat ? 'finance-row-vat' : ''} ${advanceTotal > 0 || carAdvanceTotal > 0 ? 'finance-row-advance' : ''} ${rowSelected ? 'finance-row-selected' : ''} finance-row-payment--${timing.status}`.trim()}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar pagamento de ${assignment.collaborator?.shortName || assignment.collaborator?.name || 'colaborador'}`}
                          checked={rowSelected}
                          disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                          onChange={(event) => toggleStaffPaymentSelection(assignment.id, event.target.checked)}
                        />
                      </td>
                      <td>
                        <div className="finance-staff-name">
                          <div className="finance-staff-name__line">
                            <span>{assignment.collaborator?.shortName || assignment.collaborator?.name || '-'}</span>
                            <button
                              type="button"
                              className={`icon-button finance-note-button ${hasPaymentNotes(paymentNotes) ? 'finance-note-button--active' : ''}`}
                              title={hasPaymentNotes(paymentNotes) ? 'Consultar notas internas' : 'Adicionar nota interna'}
                              aria-label={hasPaymentNotes(paymentNotes) ? 'Consultar notas internas' : 'Adicionar nota interna'}
                              onClick={() => openPaymentNotes(assignment)}
                            >
                              <NotebookPen size={14} />
                              {hasPaymentNotes(paymentNotes) ? <span className="finance-note-indicator" aria-hidden="true" /> : null}
                            </button>
                          </div>
                          {assignment.collaborator?.includeVat ? <Badge tone="warning">Inclui IVA 23%</Badge> : null}
                        </div>
                      </td>
                      <td>{assignment.event.name}</td>
                      <td>{assignmentWorkDateValue(assignment) ? date.format(new Date(assignmentWorkDateValue(assignment))) : '-'}</td>
                      <td>{durationHours(assignmentHours(assignment))}</td>
                      <td>{money.format(num(assignment.hourlyRate))}</td>
                      <td>
                        <input
                          className="finance-adjustment-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="+2,50 / -2,43"
                          value={draft.paymentAdjustment}
                          disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                          onChange={(event) => updatePaymentDraft(assignment.id, { paymentAdjustment: event.target.value })}
                          onBlur={() => savePaymentAdjustment(assignment)}
                        />
                      </td>
                      <td>
                        {advanceTotal > 0 ? (
                          <div className="finance-advance-cell">
                            <Badge tone="info">{money.format(advanceTotal)}</Badge>
                            <small>{salaryAdvanceNotes.join(' | ') || 'Desconta ao pagamento'}</small>
                          </div>
                        ) : '-'}
                      </td>
                      <td>
                        {carAdvanceTotal > 0 ? (
                          <div className="finance-advance-cell finance-advance-cell--car">
                            <Badge tone="success">{money.format(carAdvanceTotal)}</Badge>
                            <small>{carAdvanceNotes.join(' | ') || 'Viatura própria'}</small>
                          </div>
                        ) : '-'}
                      </td>
                      <td>
                        <div className="finance-pay-total">
                          <strong>{money.format(outstandingTotal)}</strong>
                          {advanceTotal > 0 ? <small>Bruto {money.format(grossTotal)}</small> : null}
                        </div>
                      </td>
                      <td>
                        <div className="finance-payment-window">
                          <Badge tone={timing.status === 'overdue' ? 'danger' : timing.status === 'open' ? 'warning' : timing.status === 'paid' ? 'success' : 'info'}>
                            {paymentTimingLabel(timing.status)}
                          </Badge>
                          <small>{paymentWindowLabel(timing)}</small>
                          {timing.deferred ? <Badge tone="info">Acumulado</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <select
                          className={`payment-state finance-staff-payment-state payment-state--${draft.paymentStatus || 'unpaid'}`}
                          disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                          value={draft.paymentStatus || 'unpaid'}
                          onChange={(event) => (
                            staffPaymentTab === 'unpaid'
                              ? updatePaymentDraft(assignment.id, { paymentStatus: event.target.value })
                              : updatePaymentStatus(assignment, event.target.value, assignment.paymentDate || null, draft.paymentAdjustment)
                          )}
                        >
                          {PAYMENT_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={draft.paymentDate}
                          disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                          onChange={(event) => (
                            staffPaymentTab === 'unpaid'
                              ? updatePaymentDraft(assignment.id, { paymentDate: event.target.value || '' })
                              : updatePaymentStatus(assignment, assignment.paymentStatus || 'unpaid', event.target.value || null, draft.paymentAdjustment)
                          )}
                        />
                      </td>
                      {staffPaymentTab === 'unpaid' ? (
                        <td>
                          <div className="finance-staff-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                              onClick={() => confirmMoveToPaid(assignment)}
                            >
                              Mover para pagos
                            </button>
                            {timing.deferred ? (
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                                onClick={() => resetPaymentMonth(assignment)}
                              >
                                Repor mês normal
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={bulkUpdatingPayments || updatingAssignmentId === assignment.id}
                                onClick={() => deferPaymentToNextMonth(assignment)}
                              >
                                Adiar mês
                              </button>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
              {!visibleStaffPayments.length ? <p className="muted">Sem registos de staff para os filtros selecionados.</p> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {activeArea === 'expenses' ? (
        <div className="finance-grid">
          <Card title="Registar Despesa">
            <form className="finance-expense-form finance-expense-form--wide" onSubmit={submitExpense}>
              <label>Data<input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })} /></label>
              <label>Fornecedor<input value={expenseForm.supplier} onChange={(event) => setExpenseForm({ ...expenseForm, supplier: event.target.value })} /></label>
              <label>Categoria
                <select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>
                  {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>Valor<input type="number" step="0.01" min="0" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} /></label>
              <label>IVA<input type="number" step="0.01" min="0" value={expenseForm.vatAmount} onChange={(event) => setExpenseForm({ ...expenseForm, vatAmount: event.target.value })} /></label>
              <label>Evento associado
                <select value={expenseForm.referenceId} onChange={(event) => setExpenseForm({ ...expenseForm, referenceId: event.target.value })}>
                  <option value="">Sem evento</option>
                  {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
                </select>
              </label>
              <label>Documento
                <input type="file" onChange={(event) => onExpenseFileSelected(event.target.files?.[0])} />
                {expenseForm.documentName ? <small>{expenseForm.documentName}</small> : null}
              </label>
              <label className="check-inline service-check">
                <input type="checkbox" checked={expenseForm.sentToAccountant} onChange={(event) => setExpenseForm({ ...expenseForm, sentToAccountant: event.target.checked })} />
                <span>Enviado para contabilista</span>
              </label>
              <label className="span-2">Notas<input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} /></label>
              <button className="command-button" type="submit" disabled={savingExpense}><Plus size={16} /> {savingExpense ? 'A guardar...' : 'Registar despesa'}</button>
            </form>
            {expenseError ? <p className="notice">{expenseError}</p> : null}
          </Card>

          <div className="finance-grid finance-grid--two">
            <Card title="IVA">
              <div className="finance-kpi-grid finance-kpi-grid--three">
                <div><Landmark size={18} /><span>Estimado a pagar</span><strong>{money.format(dashboard.vatEstimated)}</strong></div>
              </div>
              <div className="finance-month-list">
                {vatByCategory.map(([category, total]) => (
                  <div key={category}><span>{category}</span><strong>{money.format(total)}</strong></div>
                ))}
              </div>
            </Card>

            <Card title="Despesas por Categoria">
              <div className="finance-month-list">
                {expenseByCategory.map(([category, total]) => (
                  <div key={category}><span>{category}</span><strong>{money.format(total)}</strong></div>
                ))}
                {!expenseByCategory.length ? <p className="muted">Sem despesas registadas neste mês.</p> : null}
              </div>
            </Card>
          </div>

          <Card title="Despesas do Mês">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Fornecedor</th>
                    <th>Categoria</th>
                    <th>Evento</th>
                    <th>Valor</th>
                    <th>IVA</th>
                    <th>Contabilista</th>
                  </tr>
                </thead>
                <tbody>
                  {currentMonthExpenses.map((expense) => {
                    const linkedEvent = services.find((event) => Number(event.id) === Number(expense.referenceId));
                    return (
                      <tr key={expense.id}>
                        <td>{expense.date ? date.format(new Date(expense.date)) : '-'}</td>
                        <td>{expense.supplier || '-'}</td>
                        <td>{expense.category}</td>
                        <td>{linkedEvent?.name || '-'}</td>
                        <td>{money.format(num(expense.amount))}</td>
                        <td>{money.format(num(expense.vatAmount))}</td>
                        <td>
                          <select
                            className={`payment-state payment-state--${expense.sentToAccountant ? 'paid' : 'pending'}`}
                            value={expense.sentToAccountant ? 'yes' : 'no'}
                            onChange={(event) => updateExpenseSent(expense, event.target.value === 'yes')}
                          >
                            <option value="no">Não enviado</option>
                            <option value="yes">Enviado</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!currentMonthExpenses.length ? <p className="muted">Sem despesas registadas neste mês.</p> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {activeArea === 'margins' ? (
        <Card title="Comissões e Margens por Evento">
          <div className="accounting-list finance-event-list">
            {currentEventRows.map((row) => {
              const open = expandedEventId === row.id;
              return (
                <article key={row.id} className="accounting-card finance-event-card">
                  <div className="accounting-head">
                    <div className="finance-margin-grid finance-margin-grid--new">
                      <div><small>Evento</small><strong>{row.name}</strong></div>
                      <div><small>Cliente</small><strong>{row.client?.name || '-'}</strong></div>
                      <div><small>Receita</small><strong>{money.format(row.financial.revenue)}</strong></div>
                      <div><small>Staff</small><strong>{money.format(row.financial.staff)}</strong></div>
                      <div><small>Despesas</small><strong>{money.format(row.financial.operational)}</strong></div>
                      <div><small>Margem</small><strong className={row.financial.margin < 0 ? 'money-negative' : 'money-positive'}>{money.format(row.financial.margin)}</strong></div>
                      <div><small>Margem %</small><strong>{row.financial.marginPct.toFixed(1)}%</strong></div>
                      <div>
                        <small>Faturação</small>
                        <select
                          className={`payment-state payment-state--${row.billingStatus || 'pending'}`}
                          value={row.billingStatus || 'pending'}
                          disabled={updatingEventId === row.id}
                          onChange={(event) => updateEventBillingStatus(row.id, event.target.value)}
                        >
                          {BILLING_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={open ? 'Ocultar detalhes' : 'Ver detalhes'}
                      onClick={() => setExpandedEventId(open ? null : row.id)}
                    >
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                  {open ? (
                    <div className="accounting-body">
                      <table>
                        <thead>
                          <tr>
                            <th>Colaborador</th>
                            <th>Função</th>
                            <th>Horas</th>
                            <th>Valor/hora</th>
                            <th>Adiantamentos</th>
                            <th>Carro</th>
                            <th>A pagar</th>
                            <th>Estado de pagamento</th>
                            <th>Data pagamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billableAssignments(row).map((assignment) => (
                            <tr key={assignment.id}>
                              <td>{assignment.collaborator?.shortName || assignment.collaborator?.name || '-'}</td>
                              <td>{assignment.role || '-'}</td>
                              <td>{durationHours(assignmentHours(assignment))}</td>
                              <td>{money.format(num(assignment.hourlyRate))}</td>
                              <td>{assignmentAdvanceTotal(assignment) > 0 ? money.format(assignmentAdvanceTotal(assignment)) : '-'}</td>
                              <td>{assignmentCarAdvanceTotal(assignment) > 0 ? money.format(assignmentCarAdvanceTotal(assignment)) : '-'}</td>
                              <td>{money.format(assignmentOutstandingPay(assignment))}</td>
                              <td>
                                <select
                                  className={`payment-state payment-state--${assignment.paymentStatus || 'unpaid'}`}
                                  disabled={updatingAssignmentId === assignment.id}
                                  value={assignment.paymentStatus || 'unpaid'}
                                  onChange={(event) => updatePaymentStatus(assignment, event.target.value, assignment.paymentDate || null)}
                                >
                                  {PAYMENT_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="date"
                                  value={assignment.paymentDate ? String(assignment.paymentDate).slice(0, 10) : ''}
                                  disabled={updatingAssignmentId === assignment.id}
                                  onChange={(event) => updatePaymentStatus(assignment, assignment.paymentStatus || 'unpaid', event.target.value || null)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!currentEventRows.length ? <p className="muted">Sem eventos neste mês.</p> : null}
          </div>
        </Card>
      ) : null}

      {activeArea === 'treasury' ? (
        <div className="finance-grid finance-grid--two">
          <Card title="Conta Bancária">
            <div className="finance-treasury">
              <label>Conta bancária
                <input type="number" step="0.01" value={bankBalance} onChange={(event) => setBankBalance(event.target.value)} />
              </label>
              <button className="secondary-button" type="button" onClick={saveBankBalance} disabled={savingBankBalance}>
                {savingBankBalance ? 'A guardar...' : 'Atualizar'}
              </button>
            </div>
            <div className="finance-kpi-grid">
              <div><Banknote size={18} /><span>Conta bancária</span><strong>{money.format(treasury.bank)}</strong></div>
              <div><ReceiptText size={18} /><span>A receber</span><strong>{money.format(treasury.receivable)}</strong></div>
              <div><FileText size={18} /><span>A pagar</span><strong>{money.format(treasury.payable)}</strong></div>
              <div><TrendingUp size={18} /><span>Saldo projetado</span><strong className={treasury.projected < 0 ? 'money-negative' : 'money-positive'}>{money.format(treasury.projected)}</strong></div>
            </div>
          </Card>

          <Card title="Planeamento de Recebimentos">
            <div className="finance-list">
              {topItems([...invoices]
                .filter((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled')
                .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime()), 8)
                .map((invoice) => (
                  <article key={invoice.id} className="finance-list-item finance-list-item--wide">
                    <div>
                      <strong>{invoice.client?.name || '-'}</strong>
                      <small>{invoice.number} · vencimento {invoice.dueDate ? date.format(new Date(invoice.dueDate)) : '-'}</small>
                    </div>
                    <Badge tone={dayDiffFromToday(invoice.dueDate) > 0 ? 'danger' : 'info'}>{statusLabel(INVOICE_STATUS, invoice.status)}</Badge>
                    <strong>{money.format(num(invoice.total))}</strong>
                  </article>
                ))}
              {!invoices.some((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled') ? <p className="muted">Sem recebimentos pendentes.</p> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {activeArea === 'documents' ? (
        <Card title="Documentos para Contabilidade">
          <div className="finance-list">
            {expenses.filter((expense) => expense.documentName).map((expense) => (
              <article key={expense.id} className="finance-list-item finance-list-item--wide">
                <div>
                  <strong>{expense.documentName}</strong>
                  <small>{expense.supplier || expense.category} · {expense.date ? date.format(new Date(expense.date)) : '-'}</small>
                </div>
                <span>{money.format(num(expense.amount))}</span>
                <select
                  className={`payment-state payment-state--${expense.sentToAccountant ? 'paid' : 'pending'}`}
                  value={expense.sentToAccountant ? 'yes' : 'no'}
                  onChange={(event) => updateExpenseSent(expense, event.target.value === 'yes')}
                >
                  <option value="no">Não enviado</option>
                  <option value="yes">Enviado</option>
                </select>
              </article>
            ))}
            {!expenses.some((expense) => expense.documentName) ? <p className="muted">Sem documentos carregados.</p> : null}
          </div>
        </Card>
      ) : null}

      {paymentNotesAssignment ? (
        <Modal title="Notas internas do pagamento" onClose={closePaymentNotes}>
          <div className="resource-form finance-payment-notes-form">
            <div className="finance-payment-notes-context">
              <span className="finance-payment-notes-context__icon" aria-hidden="true">
                <NotebookPen size={18} />
              </span>
              <div>
                <strong>{paymentNotesAssignment.collaborator?.shortName || paymentNotesAssignment.collaborator?.name || '-'}</strong>
                <span>{paymentNotesAssignment.event?.name || '-'}</span>
              </div>
            </div>
            <div className="finance-payment-notes-editor">
              <textarea
                autoFocus
                value={paymentNotesDraft}
                placeholder="Escreva aqui as notas internas deste pagamento..."
                onChange={(event) => setPaymentNotesDraft(event.target.value)}
              />
            </div>
            <footer className="form-actions finance-payment-notes-actions">
              <button className="command-button" type="button" onClick={savePaymentNotes} disabled={savingPaymentNotes}>
                {savingPaymentNotes ? 'A guardar...' : 'Guardar'}
              </button>
              <button className="secondary-button" type="button" onClick={closePaymentNotes} disabled={savingPaymentNotes}>Cancelar</button>
            </footer>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}






