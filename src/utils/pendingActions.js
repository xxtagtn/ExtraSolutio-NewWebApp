import { isFinanceReadyEvent } from './financeReadiness.js';
import { decimalValue } from './serviceFinance.js';
import { staffPaymentTiming } from './staffPayment.js';
import { dueDateForBillingGroup } from './clientBilling.js';
import { prepaymentRemainingReminderDate } from './prepaymentPolicy.js';

const NON_BILLABLE_ASSIGNMENT = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const CLOSED_SERVICE_STATUSES = new Set(['cancelled']);
const PAID_BILLING_STATUSES = new Set(['paid']);
const OPEN_INVOICE_STATUSES = new Set(['draft', 'issued']);
const STAFF_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const PERIOD_BILLING_METHODS = new Set(['monthly', 'biweekly', 'custom']);
const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DOCUMENT_TYPE_LABELS = {
  passport: 'Passaporte',
  citizen_card: 'Cartão de Cidadão',
  residence_permit: 'Título de Residência',
  residence_title: 'Título de Residência',
};

const dateFormatter = new Intl.DateTimeFormat('pt-PT');

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

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function monthPeriodLabel(value) {
  return new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric',
  }).format(value);
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

function formatDate(value) {
  const date = validDate(value);
  return date ? dateFormatter.format(date) : '-';
}

function formatEuro(value) {
  return `${numeric(value).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function relativeDateLabel(value, today) {
  const days = daysUntil(value, today);
  if (days === null) return '-';
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  if (days > 1) return `${days} dias`;
  return `Há ${Math.abs(days)} dias`;
}

function actionDaysUntil(action, today) {
  return daysUntil(action?.dueDate, today);
}

function relativeDateWithExact(value, today) {
  const relative = relativeDateLabel(value, today);
  const exact = formatDate(value);
  if (relative === '-' || exact === '-') return relative;
  return `${relative} (${exact})`;
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

function cleanTime(value, fallback = '00:00') {
  const raw = String(value || fallback || '00:00');
  const match = raw.match(/^(\d{1,2}):?(\d{2})?/);
  if (!match) return fallback;
  const hour = String(Math.min(23, Number(match[1] || 0))).padStart(2, '0');
  const minute = String(Math.min(59, Number(match[2] || 0))).padStart(2, '0');
  return `${hour}:${minute}`;
}

function assignmentShiftStart(assignment, event) {
  const datePart = String(assignment?.assignmentDate || event?.date || '').slice(0, 10);
  if (!datePart) return null;
  const time = cleanTime(assignment?.plannedStartTime || assignment?.startTime || event?.startTime || '00:00');
  const dateTime = validDate(`${datePart}T${time}:00`);
  if (!dateTime) return null;
  return { datePart, time, dateTime };
}

function billingIssueDateForEvent(event) {
  const serviceDate = validDate(event?.date);
  if (!serviceDate) return null;
  const client = event?.client || {};
  const method = client.billingMethod || 'per_event';
  const year = serviceDate.getFullYear();
  const month = serviceDate.getMonth();
  const day = serviceDate.getDate();

  if (method === 'monthly' || method === 'custom') return lastDayOfMonth(year, month);
  if (method === 'biweekly') return day <= 15 ? new Date(year, month, 15) : lastDayOfMonth(year, month);
  if (method === 'prepaid') return startOfDay(serviceDate);
  return addDays(serviceDate, 1);
}

function billingDueDateForEvent(event, today) {
  const issueDate = billingIssueDateForEvent(event);
  if (!issueDate) return null;
  return dueDateForBillingGroup({
    method: event?.client?.billingMethod || 'per_event',
    issueDate,
    client: event?.client || {},
    events: [event],
  }, today);
}

function dateKey(value) {
  const date = validDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function billingPeriodLabel(method, issueDate) {
  const date = validDate(issueDate);
  if (!date) return 'Período de faturação';
  if (method === 'biweekly') {
    const half = date.getDate() <= 15 ? '1.ª quinzena' : '2.ª quinzena';
    return `${half} de ${monthPeriodLabel(date)}`;
  }
  return monthPeriodLabel(date);
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

function documentTypeLabel(type) {
  return DOCUMENT_TYPE_LABELS[type] || type || 'Documento';
}

function documentValidityLabel(expiry, today) {
  const days = daysUntil(expiry, today);
  if (days === null) return formatDate(expiry);
  if (days < 0) return `${formatDate(expiry)} (expirado há ${Math.abs(days)} dias)`;
  if (days === 0) return `${formatDate(expiry)} (expira hoje)`;
  return `${formatDate(expiry)} (faltam ${days} dias)`;
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
      to: `/services/${event.id}`,
      origin: clientName(event),
      meta: [clientName(event)],
      details: [
        { label: 'Cliente', value: clientName(event) },
        { label: 'Evento', value: event.name || 'Evento/Serviço' },
        { label: 'Equipa', value: `${confirmed}/${requested} confirmados` },
      ],
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
      origin: clientName(event),
      meta: [clientName(event)],
      details: [
        { label: 'Cliente', value: clientName(event) },
        { label: 'Evento', value: event.name || 'Evento/Serviço' },
        { label: 'Por validar', value: `${assignments.filter((assignment) => normalized(assignment?.validationStatus) !== 'validated').length} colaborador(es)` },
      ],
    });
  }
}

function addStaffReminderActions(actions, services, today) {
  const now = validDate(today) || new Date();
  const windowEnd = new Date(now.getTime() + STAFF_REMINDER_WINDOW_MS);
  const groups = new Map();

  for (const event of services || []) {
    if (CLOSED_SERVICE_STATUSES.has(normalized(event?.status))) continue;
    if (isFinanceReadyEvent(event)) continue;

    for (const assignment of billableAssignments(event)) {
      if (normalized(assignment?.status) !== 'confirmed') continue;

      const shift = assignmentShiftStart(assignment, event);
      if (!shift) continue;
      if (shift.dateTime < now || shift.dateTime > windowEnd) continue;

      const key = `${event.id}-${shift.datePart}-${shift.time}`;
      const group = groups.get(key) || {
        id: `staff-reminder-${key}`,
        event,
        shift,
        assignments: [],
      };
      group.assignments.push(assignment);
      groups.set(key, group);
    }
  }

  for (const group of groups.values()) {
    const event = group.event;
    const shiftLabel = `${formatDate(group.shift.datePart)} ${group.shift.time}`;
    addAction(actions, {
      id: group.id,
      category: 'Staff',
      title: 'Enviar lembrete 24h ao staff',
      description: `${event.name || 'Evento/Serviço'} tem ${group.assignments.length} colaborador(es) confirmado(s) para lembrar.`,
      priority: 'high',
      tone: 'warning',
      dueDate: group.shift.dateTime,
      to: `/services/${event.id}?tab=collaborators`,
      origin: clientName(event),
      meta: [event.name || 'Evento/Serviço', shiftLabel],
      buttonLabel: 'Preparar',
      details: [
        { label: 'Cliente', value: clientName(event) },
        { label: 'Evento', value: event.name || 'Evento/Serviço' },
        { label: 'Turno', value: shiftLabel },
        { label: 'Colaboradores', value: `${group.assignments.length} confirmado(s)` },
      ],
    });
  }
}

function addBillingActions(actions, services, today) {
  const groupedReadyToBill = new Map();

  for (const event of services || []) {
    if (CLOSED_SERVICE_STATUSES.has(normalized(event?.status))) continue;
    if (numeric(event.totalRevenue) <= 0) continue;

    const billingStatus = normalized(event.billingStatus || 'pending');
    if (PAID_BILLING_STATUSES.has(billingStatus)) continue;

    if (billingStatus === 'partial70') {
      const remainingDueDate = prepaymentRemainingReminderDate(event);
      const days = daysUntil(remainingDueDate, today);
      if (days !== null && days <= 7) {
        addAction(actions, {
          id: `service-remaining-payment-${event.id}`,
          category: 'Clientes',
          title: 'Restante pagamento pendente',
          description: `${clientName(event)} tem restante pagamento associado a ${event.name || 'Evento/Serviço'}.`,
          priority: days < 0 ? 'high' : 'medium',
          tone: days < 0 ? 'danger' : 'warning',
          dueDate: remainingDueDate,
          to: `/finance?area=clients&eventId=${event.id}`,
          origin: clientName(event),
          meta: [event.name || 'Evento/Serviço'],
          details: [
            { label: 'Cliente', value: clientName(event) },
            { label: 'Evento', value: event.name || 'Evento/Serviço' },
            { label: 'Valor', value: formatEuro(event.totalRevenue) },
            { label: 'Vencimento', value: relativeDateWithExact(remainingDueDate, today) },
          ],
        });
      }
      continue;
    }

    if (billingStatus === 'pending' || billingStatus === 'invoiced') {
      const issueDate = billingIssueDateForEvent(event);
      const dueDate = billingDueDateForEvent(event, today) || issueDate;
      const actionDate = billingStatus === 'invoiced' ? dueDate : issueDate;
      const days = daysUntil(actionDate, today);
      if (days === null || days > 0) continue;
      if (billingStatus === 'pending' && !isFinanceReadyEvent(event)) continue;

      const method = event?.client?.billingMethod || 'per_event';
      if (billingStatus === 'pending' && PERIOD_BILLING_METHODS.has(method)) {
        const clientId = event?.client?.id || normalized(clientName(event));
        const key = `${clientId}-${method}-${dateKey(issueDate)}`;
        const group = groupedReadyToBill.get(key) || {
          id: `service-billing-group-${key}`,
          method,
          client: event?.client || {},
          clientName: clientName(event),
          issueDate,
          actionDate,
          events: [],
          total: 0,
        };
        group.events.push(event);
        group.total += numeric(event.totalRevenue);
        groupedReadyToBill.set(key, group);
        continue;
      }

      addAction(actions, {
        id: `service-billing-${event.id}`,
        category: 'Clientes',
        title: billingStatus === 'invoiced' ? 'Pagamento de cliente pendente' : 'Serviço pronto para faturar',
        description: `${clientName(event)} - ${event.name || 'Evento/Serviço'}.`,
        priority: billingStatus === 'invoiced' ? 'high' : 'medium',
        tone: billingStatus === 'invoiced' ? 'warning' : 'info',
        dueDate: actionDate,
        to: billingStatus === 'invoiced' ? `/finance?area=clients&eventId=${event.id}` : `/services/${event.id}`,
        origin: clientName(event),
        meta: [`Valor: ${formatEuro(event.totalRevenue)}`],
        buttonLabel: billingStatus === 'invoiced' ? 'Abrir' : 'Faturar',
        details: billingStatus === 'invoiced'
          ? [
              { label: 'Cliente', value: clientName(event) },
              { label: 'Evento', value: event.name || 'Evento/Serviço' },
              { label: 'Valor', value: formatEuro(event.totalRevenue) },
              { label: 'Vencimento', value: relativeDateWithExact(actionDate, today) },
            ]
          : [
              { label: 'Cliente', value: clientName(event) },
              { label: 'Evento', value: event.name || 'Evento/Serviço' },
              { label: 'Valor a faturar', value: formatEuro(event.totalRevenue) },
            ],
      });
    }
  }

  for (const group of groupedReadyToBill.values()) {
    const eventIds = group.events.map((event) => event.id).filter(Boolean).join(',');
    const firstEventId = group.events.find((event) => event?.id)?.id || '';
    addAction(actions, {
      id: group.id,
      category: 'Clientes',
      title: 'Período pronto para faturar',
      description: `${group.clientName} tem ${group.events.length} serviço(s) prontos para faturação.`,
      priority: 'medium',
      tone: 'info',
      dueDate: group.actionDate,
      to: `/finance?area=clients&clientId=${group.client?.id || ''}&eventId=${firstEventId}&eventIds=${eventIds}`,
      origin: group.clientName,
      meta: [`Valor: ${formatEuro(group.total)}`],
      buttonLabel: 'Faturar',
      details: [
        { label: 'Cliente', value: group.clientName },
        { label: 'Período', value: billingPeriodLabel(group.method, group.issueDate) },
        { label: 'Eventos', value: `${group.events.length} serviço(s)` },
        { label: 'Valor a faturar', value: formatEuro(group.total) },
      ],
    });
  }
}

function addStaffPaymentActions(actions, services, today) {
  for (const event of services || []) {
    if (!isFinanceReadyEvent(event)) continue;

    for (const assignment of billableAssignments(event)) {
      if (normalized(assignment?.paymentStatus || 'unpaid') === 'paid') continue;
      const timing = staffPaymentTiming({ ...assignment, event }, today);
      if (timing.status !== 'open') continue;
      const collaborator = assignment.collaborator || {};
      addAction(actions, {
        id: `staff-payment-${assignment.id}`,
        category: 'Staff',
        title: 'Pagamento de staff pendente',
        description: `${collaboratorName(collaborator)} - ${event.name || 'Evento/Serviço'}.`,
        priority: 'medium',
        tone: 'warning',
        dueDate: timing.start || event.date,
        to: `/finance?area=staff&assignmentId=${assignment.id}`,
        origin: collaboratorName(collaborator),
        meta: [clientName(event), timing.deferred ? `Acumulado para ${timing.paymentMonth}` : `Pagamento ${timing.paymentMonth}`],
        details: [
          { label: 'Colaborador', value: collaboratorName(collaborator) },
          { label: 'Evento', value: event.name || 'Evento/Serviço' },
          { label: 'Cliente', value: clientName(event) },
        ],
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
      to: `/collaborators?collaboratorId=${collaborator.id}&section=documents`,
      origin: collaboratorName(collaborator),
      meta: [collaboratorName(collaborator), documentTypeLabel(collaborator.documentType)],
      buttonLabel: 'Ver',
      details: [
        { label: 'Colaborador', value: collaboratorName(collaborator) },
        { label: 'Documento', value: documentTypeLabel(collaborator.documentType) },
        { label: 'Validade', value: documentValidityLabel(collaborator.documentExpiry, today) },
      ],
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
        origin: clientName(budget),
        meta: [budget.reference || 'Orçamento'],
        details: [
          { label: 'Cliente', value: clientName(budget) },
          { label: 'Orçamento', value: budget.reference || `#${budget.id}` },
          { label: 'Follow-up', value: item.text || 'Pendente' },
        ],
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
          origin: clientName(budget),
          meta: [budget.reference || 'Orçamento'],
          details: [
            { label: 'Cliente', value: clientName(budget) },
            { label: 'Orçamento', value: budget.reference || `#${budget.id}` },
            { label: 'Enviado', value: `Há ${Math.abs(days)} dia(s)` },
          ],
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
      origin: invoice.client?.name || 'Cliente',
      meta: [`Valor: ${formatEuro(invoice.total)}`],
      details: [
        { label: 'Cliente', value: invoice.client?.name || 'Cliente' },
        { label: 'Fatura', value: invoice.number || `Fatura #${invoice.id}` },
        { label: 'Valor', value: formatEuro(invoice.total) },
        { label: 'Vencimento', value: relativeDateWithExact(invoice.dueDate, today) },
      ],
    });
  }
}

export function buildPendingActions(data = {}, options = {}) {
  const today = options.today || new Date();
  const actions = [];

  addTeamActions(actions, data.services || [], today);
  addHoursValidationActions(actions, data.services || [], today);
  addStaffReminderActions(actions, data.services || [], today);
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
