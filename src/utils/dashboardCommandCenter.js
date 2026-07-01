import { isFinanceReadyEvent } from './financeReadiness.js';
import { decimalValue } from './serviceFinance.js';

const NON_BILLABLE_ASSIGNMENT = new Set(['cancelled', 'missed_justified', 'missed_unjustified']);
const CLOSED_SERVICE_STATUS = new Set(['cancelled']);
const OPEN_BUDGET_STATUS = new Set(['new_request', 'sent', 'pending', 'draft']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function numeric(value) {
  return decimalValue(value) || 0;
}

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

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(value) {
  const date = startOfDay(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = startOfDay(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(value) {
  const date = startOfDay(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function serviceEndDate(service) {
  return service?.isContinuous && service.endDate ? service.endDate : service?.date;
}

function serviceStartDateTime(service) {
  if (!service?.date) return null;
  const date = String(service.date).slice(0, 10);
  const time = service.startTime || service.plannedCheckIn || '00:00';
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
  return Number.isNaN(parsed.getTime()) ? startOfDay(service.date) : parsed;
}

function isServiceOpen(service) {
  return !CLOSED_SERVICE_STATUS.has(normalized(service?.status));
}

function isDateInsideService(service, date) {
  const target = startOfDay(date);
  const start = startOfDay(service?.date);
  const end = startOfDay(serviceEndDate(service));
  if (!target || !start || !end) return false;
  return target >= start && target <= end;
}

function requestedTotal(service) {
  return safeArray(service?.requiredRoles)
    .reduce((sum, item) => sum + Math.max(0, Number(item?.qty || item?.count || 0)), 0);
}

function billableAssignments(service) {
  return (service?.assignments || [])
    .filter((assignment) => !NON_BILLABLE_ASSIGNMENT.has(normalized(assignment?.status)));
}

function confirmedAssignments(service) {
  return billableAssignments(service)
    .filter((assignment) => normalized(assignment?.status) === 'confirmed');
}

function pendingStaffCount(service) {
  return billableAssignments(service)
    .filter((assignment) => normalized(assignment?.status) === 'pending_confirmation')
    .length;
}

function pendingHoursCount(service) {
  if (!isServiceOpen(service) || isFinanceReadyEvent(service)) return 0;
  return confirmedAssignments(service)
    .filter((assignment) => normalized(assignment?.validationStatus) !== 'validated')
    .length;
}

function teamStatus(service) {
  const requested = requestedTotal(service);
  const confirmed = confirmedAssignments(service).length;
  const pending = pendingStaffCount(service);

  if (requested > 0 && confirmed >= requested) {
    return { label: 'Equipa completa', tone: 'success', actionLabel: 'Abrir' };
  }
  if (pending > 0) {
    return { label: `${pending} por confirmar`, tone: 'warning', actionLabel: 'Resolver' };
  }
  if (requested > confirmed) {
    return { label: 'Sem equipa completa', tone: 'danger', actionLabel: 'Resolver' };
  }
  return { label: 'Abrir', tone: 'neutral', actionLabel: 'Abrir' };
}

function clientName(service) {
  return service?.client?.name || service?.clientName || 'Cliente por associar';
}

function serviceTimeLabel(service) {
  const start = service?.startTime || service?.plannedCheckIn;
  const end = service?.endTime || service?.plannedCheckOut;
  if (start && end) return `${start} → ${end}`;
  if (start) return start;
  return '';
}

function serviceItem(service) {
  const status = teamStatus(service);

  return {
    id: `service-${service.id}`,
    type: 'service',
    title: service.name || 'Evento/Serviço',
    subtitle: clientName(service),
    date: service.date,
    time: serviceTimeLabel(service),
    tone: status.tone,
    badge: status.label,
    actionLabel: status.actionLabel,
    to: service.id ? `/services/${service.id}` : '/services',
  };
}

function actionItem(action) {
  return {
    id: action.id,
    type: 'action',
    title: action.title || 'Ação pendente',
    subtitle: action.description || action.category || '',
    date: action.dueDate,
    time: '',
    tone: action.tone || 'warning',
    badge: action.category || '',
    actionLabel: action.buttonLabel || (action.category === 'Staff' ? 'Enviar' : action.category === 'Clientes' ? 'Abrir Financeiro' : 'Abrir'),
    to: action.to || '/dashboard',
  };
}

function byServiceTime(a, b) {
  const aDate = serviceStartDateTime(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDate = serviceStartDateTime(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
}

function byActionDate(a, b) {
  const aDate = startOfDay(a?.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDate = startOfDay(b?.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt');
}

function actionDueToday(action, today) {
  return dateKey(action?.dueDate) === dateKey(today);
}

function actionDueInNext48h(action, today) {
  const due = startOfDay(action?.dueDate);
  const tomorrow = addDays(today, 1);
  const afterTomorrow = addDays(today, 2);
  if (!due || !tomorrow || !afterTomorrow) return false;
  return due >= tomorrow && due <= afterTomorrow;
}

function countFollowUps(budgets, today) {
  return (budgets || []).reduce((sum, budget) => {
    if (normalized(budget?.status) !== 'sent') return sum;
    return sum + safeArray(budget.followUpHistory)
      .filter((item) => {
        const due = startOfDay(item?.reminderDate);
        const now = startOfDay(today);
        return due && now && due <= now;
      })
      .length;
  }, 0);
}

export function buildDashboardCommandCenter(data = {}, options = {}) {
  const today = options.today || new Date();
  const todayEnd = endOfDay(today);
  const next48End = addDays(today, 2);
  const services = data.services || [];
  const collaborators = data.collaborators || [];
  const budgets = data.budgets || [];
  const actions = data.actions || [];

  const openServices = services.filter(isServiceOpen);
  const todayServices = openServices
    .filter((service) => isDateInsideService(service, today))
    .sort(byServiceTime);
  const next48Services = openServices
    .filter((service) => {
      const start = serviceStartDateTime(service);
      return start && todayEnd && next48End && start > todayEnd && start <= endOfDay(next48End);
    })
    .sort(byServiceTime);

  const readyToInvoice = services
    .filter((service) => isFinanceReadyEvent(service))
    .filter((service) => !['paid', 'cancelled'].includes(normalized(service.billingStatus || 'pending')))
    .reduce((sum, service) => sum + numeric(service.totalRevenue), 0);

  const yesterdayServices = openServices.filter((service) => isDateInsideService(service, addDays(today, -1)));
  const staffPending = openServices.reduce((sum, service) => sum + pendingStaffCount(service), 0);
  const hoursPending = openServices.reduce((sum, service) => sum + pendingHoursCount(service), 0);
  const yesterdayStaffPending = yesterdayServices.reduce((sum, service) => sum + pendingStaffCount(service), 0);
  const yesterdayHoursPending = yesterdayServices.reduce((sum, service) => sum + pendingHoursCount(service), 0);

  const todayActions = actions.filter((action) => actionDueToday(action, today)).sort(byActionDate);
  const next48Actions = actions.filter((action) => actionDueInNext48h(action, today)).sort(byActionDate);
  const sortedActions = [...actions].sort(byActionDate);

  const nextSevenDaysEnd = addDays(today, 6);
  const nextSevenDays = openServices.filter((service) => {
    const start = serviceStartDateTime(service);
    return start && startOfDay(start) >= startOfDay(today) && startOfDay(start) <= nextSevenDaysEnd;
  }).length;

  return {
    kpis: {
      eventsToday: {
        value: todayServices.length,
        delta: todayServices.length - yesterdayServices.length,
      },
      staffPending: {
        value: staffPending,
        delta: staffPending - yesterdayStaffPending,
      },
      hoursPending: {
        value: hoursPending,
        delta: hoursPending - yesterdayHoursPending,
      },
      readyToInvoice: {
        value: readyToInvoice,
        delta: 0,
      },
    },
    quickSummary: {
      nextSevenDays,
      activeStaff: collaborators.filter((collaborator) => normalized(collaborator?.status) === 'active').length,
      openBudgets: budgets.filter((budget) => OPEN_BUDGET_STATUS.has(normalized(budget?.status))).length,
      pendingFollowUps: countFollowUps(budgets, today),
    },
    todayItems: [
      ...todayServices.map(serviceItem),
      ...todayActions.map(actionItem),
    ].slice(0, 5),
    next48Items: [
      ...next48Services.map(serviceItem),
      ...next48Actions.map(actionItem),
    ].slice(0, 5),
    pendingActions: sortedActions.slice(0, 8),
    allPendingActions: sortedActions,
  };
}
