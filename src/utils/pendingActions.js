import { isFinanceReadyEvent } from './financeReadiness.js';
import { decimalValue } from './serviceFinance.js';
import { staffPaymentTiming } from './staffPayment.js';

const NON_BILLABLE_ASSIGNMENT = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const CLOSED_SERVICE_STATUSES = new Set(['cancelled']);
const PAID_BILLING_STATUSES = new Set(['paid']);
const OPEN_INVOICE_STATUSES = new Set(['draft', 'issued']);
const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function safeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function numeric(value) {
  return decimalValue(value) || 0;
}

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value, today) {
  const date = validDate(value);
  if (!date) return null;
  const diff = startOfDay(date).getTime() - startOfDay(today).getTime();
  return Math.round(diff / 86400000);
}

function actionDaysUntil(action, today) {
  return daysUntil(action?.dueDate, today);
}

function addAction(actions, action) {
  actions.push({
    meta: [],
    ...action,
  });
}

function eventDateTime(event) {
  if (!event?.date) return null;
  const base = String(event.date).slice(0, 10);
  const time = event.startTime || '00:00';
  return validDate(`${base}T${time}`);
}

function requiredTotal(event) {
  return safeArray(event?.requiredRoles)
    .reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0);
}

function confirmedTotal(event) {
  return (event?.assignments || [])
    .filter((assignment) => normalized(assignment?.status) === 'confirmed')
    .length;
}

function billableAssignments(event) {
  return (event?.assignments || [])
    .filter((assignment) => !NON_BILLABLE_ASSIGNMENT.has(normalized(assignment?.status)));
}

function collaboratorName(collaborator) {
  return collaborator?.shortName || collaborator?.name || `Colaborador #${collaborator?.id || ''}`.trim();
}

function clientName(value) {
  return value?.client?.name || value?.companyName || value?.clientName || value?.leadName || 'Cliente';
}

function documentPriority(days) {
  if (days === null) return null;
  if (days < 0) return 'critical';
  if (days <= 30) return 'high';
  if (days <= 60) return 'medium';
  if (days <= 90) return 'low';
  return null;
}

function documentDescription(days) {
  if (days < 0) return `Documento expirado há ${Math.abs(days)} dia(s).`;
  return `Documento expira dentro de ${days} dia(s).`;
}

function addTeamActions(actions, services, today) {
  for (const event of services || []) {
    if (CLOSED_SERVICE_STATUSES.has(normalized(event?.status))) continue;
    if (isFinanceReadyEvent(event)) continue;

    const requested = requiredTotal(event);
    if (!requested) continue;

    const confirmed = confirmedTotal(event);
    if (confirmed >= requested) continue;

    const days = daysUntil(event.date, today);
    const priority = days !== null && days <= 2 ? 'high' : 'medium';
    addAction(actions, {
      id: `service-team-${event.id}`,
      category: 'Eventos/Serviços',
      title: 'Evento sem equipa completa',
      description: `${event.name || 'Evento/Serviço'}: ${confirmed}/${requested} colaboradores confirmados.`,
      priority,
      tone: priority === 'high' ? 'warning' : 'info',
      dueDate: eventDateTime(event) || event.date,
      to: `/services?serviceId=${event.id}`,
      meta: [clientName(event)],
    });
  }
}

function addHoursValidationActions(actions, services, today) {
  for (const event of services || []) {
    if (CLOSED_SERVICE_STATUSES.has(normalized(event?.status))) continue;

    const assignments = billableAssignments(event);
    if (!assignments.length) continue;

    const allValidated = assignments.every((assignment) => normalized(assignment?.validationStatus) === 'validated');
    if (allValidated || isFinanceReadyEvent(event)) continue;

    const days = daysUntil(event.endDate || event.date, today);
    const status = normalized(event.status);
    if (days !== null && days > 1 && !status.startsWith('to_validate')) continue;

    addAction(actions, {
      id: `hours-validation-${event.id}`,
      category: 'Validação de Horas',
      title: 'Horários por validar',
      description: `${event.name || 'Evento/Serviço'} tem ${assignments.filter((assignment) => normalized(assignment?.validationStatus) !== 'validated').length} colaborador(es) por validar.`,
      priority: days !== null && days < 0 ? 'high' : 'medium',
      tone: 'warning',
      dueDate: event.endDate || event.date,
      to: `/time-validation?eventId=${event.id}`,
      meta: [clientName(event)],
    });
  }
}

function addBillingActions(actions, services, today) {
  for (const event of services || []) {
    if (CLOSED_SERVICE_STATUSES.has(normalized(event?.status))) continue;
    if (numeric(event.totalRevenue) <= 0) continue;

    const billingStatus = normalized(event.billingStatus || 'pending');
    if (PAID_BILLING_STATUSES.has(billingStatus)) continue;

    if (billingStatus === 'partial70' && event.remainingPaymentDate) {
      const days = daysUntil(event.remainingPaymentDate, today);
      if (days !== null && days <= 7) {
        addAction(actions, {
          id: `service-remaining-payment-${event.id}`,
          category: 'Clientes',
          title: 'Restante pagamento pendente',
          description: `${clientName(event)} tem restante pagamento associado a ${event.name || 'Evento/Serviço'}.`,
          priority: days < 0 ? 'high' : 'medium',
          tone: days < 0 ? 'danger' : 'warning',
          dueDate: event.remainingPaymentDate,
          to: `/finance?area=clients&eventId=${event.id}`,
          meta: [event.name || 'Evento/Serviço'],
        });
      }
      continue;
    }

    if (billingStatus === 'pending' || billingStatus === 'invoiced') {
      const days = daysUntil(event.date, today);
      const ready = isFinanceReadyEvent(event) || (days !== null && days <= 0);
      if (!ready) continue;
      addAction(actions, {
        id: `service-billing-${event.id}`,
        category: 'Clientes',
        title: billingStatus === 'invoiced' ? 'Pagamento de cliente pendente' : 'Serviço pronto para faturar',
        description: `${clientName(event)} - ${event.name || 'Evento/Serviço'}.`,
        priority: billingStatus === 'invoiced' ? 'high' : 'medium',
        tone: billingStatus === 'invoiced' ? 'warning' : 'info',
        dueDate: event.date,
        to: `/finance?area=clients&eventId=${event.id}`,
        meta: [`Valor: ${numeric(event.totalRevenue).toFixed(2)} €`],
      });
    }
  }
}

function addStaffPaymentActions(actions, services, today) {
  for (const event of services || []) {
    if (!isFinanceReadyEvent(event)) continue;

    for (const assignment of billableAssignments(event)) {
      if (normalized(assignment?.paymentStatus || 'unpaid') === 'paid') continue;
      const timing = staffPaymentTiming({ ...assignment, event }, today);
      if (!['open', 'overdue'].includes(timing.status)) continue;
      const collaborator = assignment.collaborator || {};
      addAction(actions, {
        id: `staff-payment-${assignment.id}`,
        category: 'Staff',
        title: 'Pagamento de staff pendente',
        description: `${collaboratorName(collaborator)} - ${event.name || 'Evento/Serviço'}.`,
        priority: timing.status === 'overdue' ? 'high' : 'medium',
        tone: timing.status === 'overdue' ? 'danger' : 'warning',
        dueDate: timing.start || event.date,
        to: `/finance?area=staff&assignmentId=${assignment.id}`,
        meta: [clientName(event), timing.deferred ? `Acumulado para ${timing.paymentMonth}` : `Pagamento ${timing.paymentMonth}`],
      });
    }
  }
}

function addDocumentActions(actions, collaborators, today) {
  for (const collaborator of collaborators || []) {
    if (normalized(collaborator?.status) === 'inactive') continue;
    const days = daysUntil(collaborator.documentExpiry, today);
    const priority = documentPriority(days);
    if (!priority) continue;

    addAction(actions, {
      id: `collaborator-document-${collaborator.id}`,
      category: 'Documentos',
      title: 'Documento de identificação a expirar',
      description: `${collaboratorName(collaborator)} - ${documentDescription(days)}`,
      priority,
      tone: priority === 'critical' || priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'info',
      dueDate: collaborator.documentExpiry,
      to: `/collaborators?collaboratorId=${collaborator.id}`,
      meta: [collaborator.documentType || 'Documento'],
    });
  }
}

function addBudgetActions(actions, budgets, today) {
  for (const budget of budgets || []) {
    if (normalized(budget.status) !== 'sent') continue;

    const history = safeArray(budget.followUpHistory);
    history.forEach((item, index) => {
      const days = daysUntil(item?.reminderDate, today);
      if (days === null || days > 0) return;
      addAction(actions, {
        id: `budget-followup-${budget.id}-${index}`,
        category: 'Orçamentos',
        title: 'Follow-up comercial agendado',
        description: `${clientName(budget)} - ${item.text || budget.reference || 'Orçamento enviado'}.`,
        priority: days < 0 ? 'high' : 'medium',
        tone: days < 0 ? 'danger' : 'warning',
        dueDate: item.reminderDate,
        to: `/budgets?budgetId=${budget.id}`,
        meta: [budget.reference || 'Orçamento'],
      });
    });

    if (!history.length) {
      const days = daysUntil(budget.sentAt, today);
      if (days !== null && days <= -3) {
        addAction(actions, {
          id: `budget-stale-${budget.id}`,
          category: 'Orçamentos',
          title: 'Orçamento enviado sem follow-up',
          description: `${clientName(budget)} foi enviado há ${Math.abs(days)} dia(s).`,
          priority: Math.abs(days) >= 7 ? 'high' : 'medium',
          tone: Math.abs(days) >= 7 ? 'danger' : 'warning',
          dueDate: budget.sentAt,
          to: `/budgets?budgetId=${budget.id}`,
          meta: [budget.reference || 'Orçamento'],
        });
      }
    }
  }
}

function addInvoiceActions(actions, invoices, today) {
  for (const invoice of invoices || []) {
    const status = normalized(invoice.status);
    if (!OPEN_INVOICE_STATUSES.has(status)) continue;

    const days = daysUntil(invoice.dueDate, today);
    if (days === null || days > 0) continue;

    addAction(actions, {
      id: `invoice-overdue-${invoice.id}`,
      category: 'Clientes',
      title: days < 0 ? 'Fatura vencida' : 'Fatura vence hoje',
      description: `${invoice.client?.name || 'Cliente'} - ${invoice.number || `Fatura #${invoice.id}`}.`,
      priority: days < 0 ? 'high' : 'medium',
      tone: days < 0 ? 'danger' : 'warning',
      dueDate: invoice.dueDate,
      to: `/finance?area=clients&invoiceId=${invoice.id}`,
      meta: [`Valor: ${numeric(invoice.total).toFixed(2)} €`],
    });
  }
}

export function buildPendingActions(data = {}, options = {}) {
  const today = options.today || new Date();
  const actions = [];

  addTeamActions(actions, data.services || [], today);
  addHoursValidationActions(actions, data.services || [], today);
  addBillingActions(actions, data.services || [], today);
  addStaffPaymentActions(actions, data.services || [], today);
  addDocumentActions(actions, data.collaborators || [], today);
  addBudgetActions(actions, data.budgets || [], today);
  addInvoiceActions(actions, data.invoices || [], today);

  return actions.sort((a, b) => {
    const priority = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    if (priority) return priority;
    const aDate = validDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDate = validDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

export function groupPendingActions(actions = [], today = new Date()) {
  const groups = [
    { id: 'critical', label: 'Atrasadas / críticas', actions: [] },
    { id: 'today', label: 'Hoje', actions: [] },
    { id: 'next48h', label: 'Próximas 48h', actions: [] },
    { id: 'later', label: 'Restantes', actions: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const action of actions || []) {
    const diff = actionDaysUntil(action, today);
    if (action?.priority === 'critical' || (diff !== null && diff < 0)) {
      byId.get('critical').actions.push(action);
    } else if (diff === 0) {
      byId.get('today').actions.push(action);
    } else if (diff !== null && diff <= 2) {
      byId.get('next48h').actions.push(action);
    } else {
      byId.get('later').actions.push(action);
    }
  }

  return groups.filter((group) => group.actions.length);
}
