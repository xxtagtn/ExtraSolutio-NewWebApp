import {
  Banknote,
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date, money } from '../utils/formatters.js';

const AREA_TABS = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'clients', label: 'Clientes' },
  { id: 'staff', label: 'Staff' },
  { id: 'billing', label: 'Faturação' },
  { id: 'margins', label: 'Margens' },
];

const PAYMENT_STATUS = [
  { value: 'unpaid', label: 'Por pagar' },
  { value: 'paid', label: 'Pago' },
  { value: 'awaiting_data', label: 'Aguardar dados para pagamento' },
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
const FINANCE_READY_EVENT_STATUSES = new Set(['to_validate_client', 'paid']);
const COLLABORATOR_VAT_RATE = 0.23;
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
  return num(assignment.staffPayableHours) || num(assignment.hoursWorked);
}

function assignmentBasePay(assignment) {
  const explicit = num(assignment.totalPay);
  if (explicit > 0) return explicit;
  return assignmentHours(assignment) * num(assignment.hourlyRate);
}

function assignmentPayWithVat(assignment) {
  const base = assignmentBasePay(assignment);
  const includesVat = Boolean(assignment?.collaborator?.includeVat);
  const total = includesVat ? base * (1 + COLLABORATOR_VAT_RATE) : base;
  return Number(total.toFixed(2));
}

function eventStaffCost(event) {
  const total = billableAssignments(event).reduce((sum, assignment) => sum + assignmentPayWithVat(assignment), 0);
  return total || num(event.totalCost);
}

function eventRevenue(event) {
  return num(event.totalRevenue);
}

function isFinanceReadyEvent(event) {
  const operationalStatus = String(event?.status || '').trim().toLowerCase();
  const billingStatus = String(event?.billingStatus || '').trim().toLowerCase();
  return FINANCE_READY_EVENT_STATUSES.has(operationalStatus) || CLOSED_BILLING_STATUSES.has(billingStatus);
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
  if (group.method === 'prepaid') {
    const eventDate = startOfDay(group.events[0].date);
    const today = startOfDay(new Date());
    return eventDate < today ? today : eventDate;
  }
  return addDays(group.issueDate, paymentTermDays(group.client));
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
  const { data: services, loading, error, reload } = useApi('/services', []);
  const { data: invoices, reload: reloadInvoices } = useApi('/invoices', []);
  const { data: clients } = useApi('/clients', []);
  const { data: transactions, reload: reloadTransactions } = useApi('/transactions', []);
  const [activeArea, setActiveArea] = useState('overview');
  const [selectedMonth, setSelectedMonth] = useState(() => monthInputValue());
  const [staffFilters, setStaffFilters] = useState({ eventId: 'all', collaboratorId: 'all', date: '' });
  const [staffPaymentTab, setStaffPaymentTab] = useState('unpaid');
  const [staffPaymentDrafts, setStaffPaymentDrafts] = useState({});
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [updatingAssignmentId, setUpdatingAssignmentId] = useState(null);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState(null);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [expenseForm, setExpenseForm] = useState(emptyExpense());
  const [expenseError, setExpenseError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [bankBalance, setBankBalance] = useState('');
  const [savingBankBalance, setSavingBankBalance] = useState(false);
  const [selectedYear, selectedMonthNumber] = String(selectedMonth || monthInputValue()).split('-');

  const financeServices = useMemo(
    () => services.filter((event) => isFinanceReadyEvent(event)),
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

  const currentMonthServices = useMemo(
    () => financeServices.filter((event) => isSameMonth(event.date, selectedMonth)),
    [financeServices, selectedMonth],
  );

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
    }
    for (const invoice of invoices) {
      if (invoice?.issueDate) years.add(String(new Date(invoice.issueDate).getFullYear()));
    }
    for (const expense of expenses) {
      if (expense?.date) years.add(String(new Date(expense.date).getFullYear()));
    }
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [services, invoices, expenses]);

  const eventRows = useMemo(() => financeServices.map((event) => {
    const eventInvoices = invoices.filter((invoice) => invoiceIncludesEvent(invoice, event.id));
    const linkedExpenses = expenses.filter((expense) => Number(expense.referenceId) === Number(event.id));
    const revenue = eventRevenue(event);
    const staff = eventStaffCost(event);
    const operational = num(event.travelExpenseAmount) + linkedExpenses.reduce((sum, expense) => sum + num(expense.amount), 0);
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
  }), [financeServices, invoices, expenses]);

  const currentEventRows = useMemo(
    () => eventRows.filter((event) => isSameMonth(event.date, selectedMonth)),
    [eventRows, selectedMonth],
  );

  const directReceivableByClient = useMemo(() => {
    const map = new Map();
    for (const event of eventRows) {
      if (!event.clientId || event.financial.receivable <= 0) continue;
      if (event.financial.hasInvoice) continue;
      if (!['paid', 'partial70'].includes(String(event.billingStatus || ''))) continue;
      const key = Number(event.clientId);
      map.set(key, (map.get(key) || 0) + num(event.financial.receivable));
    }
    return map;
  }, [eventRows]);

  const billingGroups = useMemo(
    () => buildBillingGroups(financeServices, invoices),
    [financeServices, invoices],
  );

  const currentBillingGroups = useMemo(
    () => billingGroups.filter((group) => isSameMonth(group.issueDate, selectedMonth) || group.events.some((event) => isSameMonth(event.date, selectedMonth))),
    [billingGroups, selectedMonth],
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

  const clientRows = useMemo(() => clients.map((client) => {
    const clientInvoices = invoices.filter((invoice) => Number(invoice.clientId) === Number(client.id));
    const unpaidInvoices = clientInvoices.filter((invoice) => !invoiceIsPaid(invoice) && invoice.status !== 'cancelled');
    const clientGroups = billingGroups.filter((group) => Number(group.client?.id) === Number(client.id));
    const billedOpen = num(directReceivableByClient.get(Number(client.id)));
    const overdue = unpaidInvoices
      .map((invoice) => ({ invoice, days: dayDiffFromToday(invoice.dueDate) }))
      .filter((item) => item.days > 0)
      .sort((a, b) => b.days - a.days)[0];
    const invoiceDebt = unpaidInvoices.reduce((sum, invoice) => sum + num(invoice.total), 0);
    const pendingBilling = clientGroups.reduce((sum, group) => sum + num(group.total), 0);
    const nonInvoicedServices = eventRows
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
    return {
      ...client,
      invoices: clientInvoices
        .filter((invoice) => invoice.status !== 'cancelled')
        .sort((a, b) => new Date(b.issueDate || 0).getTime() - new Date(a.issueDate || 0).getTime()),
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
  }).sort((a, b) => b.totalOpen - a.totalOpen), [clients, invoices, billingGroups, directReceivableByClient, eventRows]);

  const staffEventOptions = useMemo(
    () => [...currentMonthServices]
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      .map((event) => ({
        id: String(event.id),
        label: `${event.date ? date.format(new Date(event.date)) : '-'} · ${event.name}`,
      })),
    [currentMonthServices],
  );

  const staffCollaboratorOptions = useMemo(() => {
    const map = new Map();
    for (const event of currentMonthServices) {
      for (const assignment of billableAssignments(event)) {
        if (!assignment.collaboratorId || map.has(String(assignment.collaboratorId))) continue;
        map.set(String(assignment.collaboratorId), {
          id: String(assignment.collaboratorId),
          label: `${assignment.collaborator?.shortName || assignment.collaborator?.name || '-'} | ${assignment.collaborator?.nif || '-'}`,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [currentMonthServices]);

  useEffect(() => {
    if (staffFilters.eventId !== 'all' && !staffEventOptions.some((event) => event.id === staffFilters.eventId)) {
      setStaffFilters((prev) => ({ ...prev, eventId: 'all' }));
    }
  }, [staffEventOptions, staffFilters.eventId]);

  useEffect(() => {
    if (staffFilters.collaboratorId !== 'all' && !staffCollaboratorOptions.some((collaborator) => collaborator.id === staffFilters.collaboratorId)) {
      setStaffFilters((prev) => ({ ...prev, collaboratorId: 'all' }));
    }
  }, [staffCollaboratorOptions, staffFilters.collaboratorId]);

  useEffect(() => {
    if (staffFilters.date && staffFilters.date.slice(0, 7) !== selectedMonth) {
      setStaffFilters((prev) => ({ ...prev, date: '' }));
    }
  }, [selectedMonth, staffFilters.date]);

  const filteredStaffEntries = useMemo(() => currentMonthServices
    .filter((event) => {
      if (staffFilters.eventId !== 'all' && String(event.id) !== staffFilters.eventId) return false;
      if (staffFilters.date && dateInputValue(event.date) !== staffFilters.date) return false;
      return true;
    })
    .flatMap((event) => billableAssignments(event)
      .filter((assignment) => staffFilters.collaboratorId === 'all' || String(assignment.collaboratorId) === staffFilters.collaboratorId)
      .map((assignment) => ({ ...assignment, event }))),
  [currentMonthServices, staffFilters]);

  const currentStaffCollaboratorCount = useMemo(() => {
    const ids = new Set();
    for (const event of currentMonthServices) {
      for (const assignment of billableAssignments(event)) {
        if (assignment.collaboratorId) ids.add(String(assignment.collaboratorId));
      }
    }
    return ids.size;
  }, [currentMonthServices]);

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
      current.total += assignmentPayWithVat(assignment);
      current.unpaid += assignment.paymentStatus === 'paid' ? 0 : assignmentPayWithVat(assignment);
      current.events += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filteredStaffEntries]);

  const staffByMonth = useMemo(() => {
    const map = new Map();
    for (const event of financeServices) {
      if (staffFilters.eventId !== 'all' && String(event.id) !== staffFilters.eventId) continue;
      if (staffFilters.date && dateInputValue(event.date) !== staffFilters.date) continue;
      const assignments = billableAssignments(event)
        .filter((assignment) => staffFilters.collaboratorId === 'all' || String(assignment.collaboratorId) === staffFilters.collaboratorId);
      const total = assignments.reduce((sum, assignment) => sum + assignmentPayWithVat(assignment), 0);
      if (total <= 0) continue;
      const key = monthKey(event.date);
      map.set(key, (map.get(key) || 0) + total);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 8);
  }, [financeServices, staffFilters]);

  const currentMonthUnpaidAssignments = useMemo(() => currentMonthServices.flatMap((event) => billableAssignments(event)
    .filter((assignment) => assignment.paymentStatus !== 'paid')
    .map((assignment) => ({ ...assignment, event })))
    .sort((a, b) => new Date(a.event.date || 0).getTime() - new Date(b.event.date || 0).getTime()), [currentMonthServices]);

  const filteredAssignments = useMemo(() => filteredStaffEntries
    .sort((a, b) => new Date(a.event.date || 0).getTime() - new Date(b.event.date || 0).getTime()),
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
      .reduce((assignmentSum, assignment) => assignmentSum + assignmentPayWithVat(assignment), 0), 0);
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
    const unpaidStaff = currentMonthUnpaidAssignments.reduce((sum, assignment) => sum + assignmentPayWithVat(assignment), 0);
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

  async function updatePaymentStatus(assignment, paymentStatus, paymentDate = assignment.paymentDate || null) {
    setUpdatingAssignmentId(assignment.id);
    try {
      const normalizedDate = paymentStatus === 'paid'
        ? (paymentDate || todayIso())
        : null;
      await api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ paymentStatus, paymentDate: normalizedDate }),
      });
      reload();
    } finally {
      setUpdatingAssignmentId(null);
    }
  }

  function paymentDraftFor(assignment) {
    const current = staffPaymentDrafts[assignment.id] || {};
    return {
      paymentStatus: current.paymentStatus || assignment.paymentStatus || 'unpaid',
      paymentDate: current.paymentDate ?? (assignment.paymentDate ? String(assignment.paymentDate).slice(0, 10) : ''),
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
    const nextStatus = draft.paymentStatus === 'paid' ? 'paid' : 'paid';
    const nextDate = draft.paymentDate || todayIso();
    await updatePaymentStatus(assignment, nextStatus, nextDate);
    setStaffPaymentDrafts((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
  }

  async function updateEventBillingStatus(eventId, billingStatus) {
    setUpdatingEventId(eventId);
    try {
      await api(`/services/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ billingStatus }),
      });
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
      await Promise.all(eventIds.map((eventId) => api(`/services/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ billingStatus: status === 'paid' ? 'paid' : 'invoiced' }),
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

  const dashboardItems = [
    { label: 'Faturação emitida', value: money.format(dashboard.issued), detail: monthLabel(selectedMonth) },
    { label: 'Faturação recebida', value: money.format(dashboard.received), detail: 'Recebido / sinalizado' },
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
            onClick={() => setActiveArea(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
                  <article key={`client-${client.id}`} className="finance-action-item finance-action-item--danger">
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
                  <article key={client.id} className="finance-list-item finance-list-item--wide">
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
                {clientRows.map((client) => (
                  <tr key={client.id}>
                    <td>{client.name}</td>
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
                          className={`payment-state payment-state--${client.actionableService.billingStatus || 'pending'}`}
                          value={client.actionableService.billingStatus || 'pending'}
                          disabled={updatingEventId === client.actionableService.id}
                          onChange={(event) => updateEventBillingStatus(client.actionableService.id, event.target.value)}
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activeArea === 'billing' ? (
        <div className="finance-grid">
          <Card title="Por Faturar" action={<Link className="secondary-button" to="/invoices"><ReceiptText size={16} /> Abrir Faturação</Link>}>
            <div className="finance-billing-list">
              {currentBillingGroups.map((group) => (
                <article key={group.key} className="finance-billing-card">
                  <div>
                    <small>{BILLING_METHOD_LABELS[group.method] || group.method}</small>
                    <strong>{group.label}</strong>
                    <span>{group.events.length} evento(s) · emissão {date.format(group.issueDate)} · vencimento {date.format(group.dueDate || group.issueDate)}</span>
                  </div>
                  <div className="finance-billing-events">
                    {group.events.slice(0, 5).map((event) => (
                      <span key={event.id}>{event.date ? date.format(new Date(event.date)) : '-'} · {event.name}</span>
                    ))}
                    {group.events.length > 5 ? <span>+ {group.events.length - 5} evento(s)</span> : null}
                  </div>
                  <strong>{money.format(group.total)}</strong>
                </article>
              ))}
              {!currentBillingGroups.length ? <p className="muted">Sem eventos pendentes de faturação neste mês.</p> : null}
            </div>
          </Card>

          <Card title="Faturas Emitidas">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Período / Evento</th>
                    <th>Emissão</th>
                    <th>Vencimento</th>
                    <th>Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {currentMonthInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.number}</td>
                      <td>{invoice.client?.name || '-'}</td>
                      <td>{invoice.billingPeriodLabel || invoice.event?.name || '-'}</td>
                      <td>{invoice.issueDate ? date.format(new Date(invoice.issueDate)) : '-'}</td>
                      <td>{invoice.dueDate ? date.format(new Date(invoice.dueDate)) : '-'}</td>
                      <td>{money.format(num(invoice.total))}</td>
                      <td>
                        <select
                          className={`payment-state payment-state--${invoice.status === 'paid' ? 'paid' : invoice.status === 'issued' ? 'pending' : 'awaiting_data'}`}
                          value={invoice.status || 'issued'}
                          disabled={updatingInvoiceId === invoice.id}
                          onChange={(event) => updateInvoiceStatus(invoice, event.target.value)}
                        >
                          {INVOICE_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!currentMonthInvoices.length ? <p className="muted">Sem faturas emitidas neste mês.</p> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {activeArea === 'staff' ? (
        <div className="finance-grid finance-grid--two">
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
                      <td>{row.hours.toFixed(2)} h</td>
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Evento</th>
                    <th>Data</th>
                    <th>Horas</th>
                    <th>Valor/h</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Data pagamento</th>
                    {staffPaymentTab === 'unpaid' ? <th>Ação</th> : null}
                  </tr>
                </thead>
                <tbody>
              {visibleStaffPayments.map((assignment) => (
                    (() => {
                      const draft = paymentDraftFor(assignment);
                      return (
                    <tr key={assignment.id} className={assignment.collaborator?.includeVat ? 'finance-row-vat' : ''}>
                      <td>
                        <div className="finance-staff-name">
                          <span>{assignment.collaborator?.shortName || assignment.collaborator?.name || '-'}</span>
                          {assignment.collaborator?.includeVat ? <Badge tone="warning">Inclui IVA 23%</Badge> : null}
                        </div>
                      </td>
                      <td>{assignment.event.name}</td>
                      <td>{assignment.event.date ? date.format(new Date(assignment.event.date)) : '-'}</td>
                      <td>{assignmentHours(assignment).toFixed(2)} h</td>
                      <td>{money.format(num(assignment.hourlyRate))}</td>
                      <td>{money.format(assignmentPayWithVat(assignment))}</td>
                      <td>
                        <select
                          className={`payment-state payment-state--${draft.paymentStatus || 'unpaid'}`}
                          disabled={updatingAssignmentId === assignment.id}
                          value={draft.paymentStatus || 'unpaid'}
                          onChange={(event) => (
                            staffPaymentTab === 'unpaid'
                              ? updatePaymentDraft(assignment.id, { paymentStatus: event.target.value })
                              : updatePaymentStatus(assignment, event.target.value, assignment.paymentDate || null)
                          )}
                        >
                          {PAYMENT_STATUS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={draft.paymentDate}
                          disabled={updatingAssignmentId === assignment.id}
                          onChange={(event) => (
                            staffPaymentTab === 'unpaid'
                              ? updatePaymentDraft(assignment.id, { paymentDate: event.target.value || '' })
                              : updatePaymentStatus(assignment, assignment.paymentStatus || 'unpaid', event.target.value || null)
                          )}
                        />
                      </td>
                      {staffPaymentTab === 'unpaid' ? (
                        <td>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={updatingAssignmentId === assignment.id}
                            onClick={() => confirmMoveToPaid(assignment)}
                          >
                            Mover para pagos
                          </button>
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
                            <th>Total a pagar</th>
                            <th>Estado de pagamento</th>
                            <th>Data pagamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billableAssignments(row).map((assignment) => (
                            <tr key={assignment.id}>
                              <td>{assignment.collaborator?.shortName || assignment.collaborator?.name || '-'}</td>
                              <td>{assignment.role || '-'}</td>
                              <td>{assignmentHours(assignment).toFixed(2)} h</td>
                              <td>{money.format(num(assignment.hourlyRate))}</td>
                              <td>{money.format(assignmentPayWithVat(assignment))}</td>
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
    </div>
  );
}






