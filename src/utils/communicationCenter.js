const NON_CONTACTABLE_ASSIGNMENT_STATUSES = new Set(['cancelled', 'missed_justified', 'missed_unjustified']);
const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmado']);
const MANUAL_STATES = new Set(['pending_contact', 'ready', 'prepared', 'sent', 'responded', 'confirmed', 'unavailable']);

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

function dateKey(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
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

function isInNext24Hours(service = {}, assignment = {}, today = new Date()) {
  const startsAt = parseDateTime(assignmentDate(assignment, service), assignmentStart(assignment, service));
  if (!startsAt) return false;
  const now = today instanceof Date ? today : new Date(today);
  const diff = startsAt.getTime() - now.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
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
      const kind = CONFIRMED_STATUSES.has(status)
        ? (isInNext24Hours(service, assignment, today) ? 'reminder_24h' : 'confirmed')
        : 'confirmation';

      if (kind === 'confirmed') continue;

      const latestLog = latestLogFor(communicationLogs, assignment.id, kind);
      const message = text(latestLog?.message) || buildMessage({ kind, service, assignment, collaborator });
      const state = CONFIRMED_STATUSES.has(status)
        ? (latestLog?.status && MANUAL_STATES.has(latestLog.status) ? latestLog.status : 'ready')
        : (latestLog?.status && MANUAL_STATES.has(latestLog.status) ? latestLog.status : 'pending_contact');

      tasks.push({
        id: `${kind}-${assignment.id}`,
        kind,
        state,
        latestLog,
        serviceId: service.id,
        assignmentId: assignment.id,
        collaboratorId: assignment.collaboratorId,
        eventName: text(service.name) || 'Evento/Serviço',
        clientName: clientDisplayName(service),
        collaboratorName: collaboratorDisplayName(collaborator),
        role: text(assignment.role),
        phone: normalizePhoneForWaLink(collaborator.phone),
        rawPhone: text(collaborator.phone),
        date: assignmentDate(assignment, service),
        startTime: assignmentStart(assignment, service),
        endTime: assignmentEnd(assignment, service),
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
    return a.collaboratorName.localeCompare(b.collaboratorName, 'pt');
  });
}

export function communicationSummary(tasks = []) {
  return tasks.reduce((summary, task) => {
    const state = task.state || '';
    summary.total += 1;
    if (state === 'pending_contact' || state === 'ready') summary.pendingContact += 1;
    if (state === 'sent') summary.sent += 1;
    if (state === 'responded') summary.responded += 1;
    if (state === 'confirmed') summary.confirmed += 1;
    if (state === 'unavailable') summary.unavailable += 1;
    return summary;
  }, {
    total: 0,
    pendingContact: 0,
    sent: 0,
    responded: 0,
    confirmed: 0,
    unavailable: 0,
  });
}
