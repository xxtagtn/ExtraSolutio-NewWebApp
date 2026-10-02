import { eventDayKey } from './eventCancelledDays.js';

const NON_CONTACTABLE_ASSIGNMENT_STATUSES = new Set(['cancelled', 'missed_justified', 'missed_unjustified']);
const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmado']);
const MANUAL_STATES = new Set([
  'scheduled',
  'pending_contact',
  'ready',
  'prepared',
  'sending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'responded',
  'confirmed',
  'unavailable',
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

function dateKey(value) {
  return eventDayKey(value);
}

function parseDateTime(dateValue, timeValue = '') {
  const day = dateKey(dateValue);
  if (!day) return null;
  const time = text(timeValue) || '00:00';
  const parsed = new Date(`${day}T${time.length === 5 ? `${time}:00` : time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDatePt(value) {
  const parsed = new Date(dateKey(value));
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function assignmentDate(assignment = {}, service = {}) {
  return dateKey(assignment.assignmentDate || service.date);
}

function assignmentStart(assignment = {}, service = {}) {
  return text(assignment.plannedCheckIn || assignment.checkIn || service.startTime);
}

function assignmentEnd(assignment = {}, service = {}) {
  return text(assignment.plannedCheckOut || assignment.checkOut || service.endTime);
}

export function communicationAssignmentSchedule(assignment = {}, service = {}) {
  return { date: assignmentDate(assignment, service), startTime: assignmentStart(assignment, service), endTime: assignmentEnd(assignment, service) };
}

function collaboratorDisplayName(collaborator = {}) {
  return text(collaborator.shortName) || text(collaborator.name) || 'Colaborador';
}

function clientDisplayName(service = {}) {
  return text(service.client?.name) || text(service.clientName) || 'Cliente por associar';
}

function latestLogFor(logs = [], assignmentId, type) {
  return logs
    .filter((log) => Number(log.assignmentId) === Number(assignmentId) && (!type || log.type === type))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

function isInNext24Hours(service, assignment, today, resolveStart) {
  const startsAt = resolveStart(assignmentDate(assignment, service), assignmentStart(assignment, service) || '00:00');
  if (!startsAt) return false;
  const now = today instanceof Date ? today : new Date(today);
  const diff = startsAt.getTime() - now.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

function isUpcoming(service, assignment, today, resolveStart) {
  const startsAt = resolveStart(assignmentDate(assignment, service), assignmentStart(assignment, service) || '00:00');
  return Boolean(startsAt && startsAt.getTime() >= new Date(today).getTime());
}

function line(label, value) {
  const clean = text(value);
  return clean ? `${label}: ${clean}` : '';
}

function buildMessage({ kind, service, assignment, collaborator }) {
  const name = collaboratorDisplayName(collaborator);
  const eventName = text(service.name) || 'serviço';
  const day = formatDatePt(assignmentDate(assignment, service));
  const start = assignmentStart(assignment, service);
  const end = assignmentEnd(assignment, service);
  const intro = kind === 'reminder_24h'
    ? `Olá ${name}, lembramos que tens serviço:`
    : `Olá ${name}, confirmas disponibilidade para:`;

  return [
    intro,
    eventName,
    line('Cliente', clientDisplayName(service)),
    line('Data', day),
    line('Entrada', start),
    line('Saída prevista', end),
    line('Função', assignment.role),
    line('Uniforme', service.uniform),
    line('Local', service.location),
    kind === 'reminder_24h' ? 'Informa a equipa ExtraSolutio, caso não consigas.' : 'Responde por favor com Confirmo ou Não disponível.',
  ].filter(Boolean).join('\n');
}

export function normalizePhoneForWaLink(value) {
  let digits = text(value).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('9')) digits = `351${digits}`;
  return digits;
}

export function whatsappManualUrl(phone, message) {
  const normalizedPhone = normalizePhoneForWaLink(phone);
  if (!normalizedPhone) return '';
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || '')}`;
}

export function buildCommunicationCenter(data = {}, options = {}) {
  const today = options.today || new Date();
  const resolveStart = options.resolveStart || parseDateTime;
  const services = Array.isArray(data.services) ? data.services : [];
  const communicationLogs = Array.isArray(data.communicationLogs) ? data.communicationLogs : [];
  const tasks = [];

  for (const service of services) {
    if (normalized(service.status) === 'cancelled') continue;
    for (const assignment of service.assignments || []) {
      if (!assignment?.collaboratorId || !assignment?.id) continue;
      if (NON_CONTACTABLE_ASSIGNMENT_STATUSES.has(normalized(assignment.status))) continue;

      const collaborator = assignment.collaborator || {};
      const status = normalized(assignment.status);
      const confirmed = CONFIRMED_STATUSES.has(status);
      const dueIn24Hours = confirmed && isInNext24Hours(service, assignment, today, resolveStart);
      const kind = confirmed
        ? (isUpcoming(service, assignment, today, resolveStart) ? 'reminder_24h' : 'confirmed')
        : 'confirmation';

      if (kind === 'confirmed') continue;

      const latestLog = latestLogFor(assignment.communicationLogs || communicationLogs, assignment.id, kind);
      const message = options.includeMessage === false ? '' : text(latestLog?.message) || buildMessage({ kind, service, assignment, collaborator });
      const state = confirmed
        ? (latestLog?.status && MANUAL_STATES.has(latestLog.status)
          ? latestLog.status
          : (dueIn24Hours ? 'ready' : 'scheduled'))
        : (latestLog?.status && MANUAL_STATES.has(latestLog.status) ? latestLog.status : 'pending_contact');

      tasks.push({
        id: `${kind}-${assignment.id}`,
        kind,
        state,
        latestLog,
        serviceId: service.id,
        assignmentId: assignment.id,
        collaboratorId: assignment.collaboratorId,
        whatsappEnabled: assignment.whatsappEnabled !== false,
        eventName: text(service.name) || 'Evento/Serviço',
        clientName: clientDisplayName(service),
        collaboratorName: collaboratorDisplayName(collaborator),
        role: text(assignment.role),
        phone: normalizePhoneForWaLink(collaborator.phone),
        rawPhone: text(collaborator.phone),
        ...communicationAssignmentSchedule(assignment, service),
        uniform: text(service.uniform),
        location: text(service.location),
        message,
        whatsappUrl: whatsappManualUrl(collaborator.phone, message),
      });
    }
  }

  return tasks.sort((a, b) => {
    const byDate = `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
    if (byDate) return byDate;
    return a.collaboratorName.localeCompare(b.collaboratorName, 'pt') || a.assignmentId - b.assignmentId;
  });
}

function uniqueTaskValues(tasks, property) {
  return [...new Set(tasks.map((task) => text(task[property])).filter(Boolean))];
}

function taskScheduleLabel(task) {
  return [task.startTime, task.endTime].filter(Boolean).join(' → ') || 'Horário a confirmar';
}

function buildDailyReminderMessage(tasks) {
  const first = tasks[0];
  return [
    `Olá ${first.collaboratorName}, lembramos que tens ${tasks.length === 1 ? 'um serviço confirmado' : 'serviços confirmados'} nesse dia:`,
    `Data: ${formatDatePt(first.date)}`,
    ...tasks.map((task) => [
      `• ${task.eventName}${task.role ? ` · ${task.role}` : ''}`,
      `  Horário: ${taskScheduleLabel(task)}`,
      task.clientName ? `  Cliente: ${task.clientName}` : '',
      task.location ? `  Local: ${task.location}` : '',
    ].filter(Boolean).join('\n')),
    'Informa a equipa ExtraSolutio, caso não consigas.',
  ].join('\n\n');
}

export function groupDailyReminderTasks(tasks = []) {
  const groups = new Map();

  for (const task of tasks) {
    const key = task.kind === 'reminder_24h' && task.collaboratorId && task.date
      ? `${task.kind}:${task.collaboratorId}:${task.date}`
      : `task:${task.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  return [...groups.values()].map((rows) => {
    const assignmentTasks = [...rows].sort((left, right) => (
      String(left.startTime || '').localeCompare(String(right.startTime || ''))
      || Number(left.assignmentId || 0) - Number(right.assignmentId || 0)
    ));
    const first = assignmentTasks[0];
    if (assignmentTasks.length === 1 || first.kind !== 'reminder_24h') {
      return {
        ...first,
        assignmentTasks,
        assignmentIds: assignmentTasks.map((task) => task.assignmentId),
        scheduleLabel: taskScheduleLabel(first),
        serviceIds: [...new Set(assignmentTasks.map((task) => task.serviceId))],
      };
    }

    const latestLogTask = assignmentTasks
      .filter((task) => task.latestLog)
      .sort((left, right) => (
        new Date(right.latestLog.createdAt || 0).getTime()
        - new Date(left.latestLog.createdAt || 0).getTime()
      ))[0];
    const message = buildDailyReminderMessage(assignmentTasks);
    return {
      ...first,
      id: `reminder_24h-day-${first.collaboratorId}-${first.date}`,
      state: latestLogTask?.state || first.state,
      latestLog: latestLogTask?.latestLog || null,
      eventName: uniqueTaskValues(assignmentTasks, 'eventName').join(' · '),
      clientName: uniqueTaskValues(assignmentTasks, 'clientName').join(' · '),
      role: uniqueTaskValues(assignmentTasks, 'role').join(' · '),
      location: uniqueTaskValues(assignmentTasks, 'location').join(' · '),
      scheduleLabel: assignmentTasks.map(taskScheduleLabel).join(' · '),
      whatsappEnabled: assignmentTasks.every((task) => task.whatsappEnabled),
      assignmentTasks,
      assignmentIds: assignmentTasks.map((task) => task.assignmentId),
      serviceIds: [...new Set(assignmentTasks.map((task) => task.serviceId))],
      message,
      whatsappUrl: whatsappManualUrl(first.rawPhone || first.phone, message),
    };
  }).sort((left, right) => {
    const byDate = `${left.date || ''} ${left.startTime || ''}`.localeCompare(`${right.date || ''} ${right.startTime || ''}`);
    return byDate || left.collaboratorName.localeCompare(right.collaboratorName, 'pt');
  });
}

export function communicationSummary(tasks = []) {
  return tasks.reduce((summary, task) => {
    const state = task.state || '';
    summary.total += 1;
    if (state === 'pending_contact' || state === 'ready') summary.pendingContact += 1;
    if (state === 'scheduled') summary.scheduled += 1;
    if (state === 'accepted') summary.accepted += 1;
    if (state === 'sent') summary.sent += 1;
    if (state === 'delivered' || state === 'read') summary.delivered += 1;
    if (state === 'responded') summary.responded += 1;
    if (state === 'confirmed') summary.confirmed += 1;
    if (state === 'unavailable') summary.unavailable += 1;
    return summary;
  }, {
    total: 0,
    scheduled: 0,
    pendingContact: 0,
    accepted: 0,
    sent: 0,
    delivered: 0,
    responded: 0,
    confirmed: 0,
    unavailable: 0,
  });
}
