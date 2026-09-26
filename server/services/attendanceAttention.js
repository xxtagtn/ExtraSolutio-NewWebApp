import { eventDayKey, isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';
import { communicationQrCandidateWhere, communicationQrWindow } from '../utils/communicationQrWindow.js';
import { eventStartInstant } from '../utils/eventTime.js';

const excludedStatuses = new Set(['cancelled', 'canceled', 'removed', 'missed_justified', 'missed_unjustified']);
const closedEventStatuses = new Set(['cancelled', 'canceled', 'finalized', 'completed', 'invoiced', 'paid']);
const normalized = (value) => String(value || '').trim().toLowerCase();
const validTime = (value) => /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value || '').trim());

export function buildAttendanceAttention(assignments, { now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon' } = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const today = eventDayKey(Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])));
  const items = [];
  for (const assignment of assignments) {
    const event = assignment.event || {};
    if (!assignment.collaboratorId || excludedStatuses.has(normalized(assignment.status))
      || closedEventStatuses.has(normalized(event.status)) || normalized(assignment.validationStatus) === 'validated'
      || isAssignmentOnCancelledDay(assignment, event)) continue;
    const checkIn = String(assignment.checkIn || '').trim();
    const checkOut = String(assignment.checkOut || '').trim();
    if (validTime(checkIn) && validTime(checkOut)) continue;

    const day = eventDayKey(assignment.assignmentDate || event.date);
    const startTime = assignment.plannedCheckIn || event.startTime || '';
    const endTime = assignment.plannedCheckOut || event.endTime || '';
    const planned = communicationQrWindow({ ...assignment, checkIn: null, checkOut: null }, event, timeZone);
    const startsAt = validTime(startTime) ? eventStartInstant(day, startTime, timeZone) : null;
    // Include today's services and recent overnight services, not historical backlog.
    if (day !== today && !(planned && now >= planned.startsAt && now < planned.visibleUntil)) continue;

    let kind;
    let reason;
    let since = startsAt || eventStartInstant(day, '00:00', timeZone);
    if ((checkIn && !validTime(checkIn)) || (checkOut && !validTime(checkOut))) {
      kind = 'incomplete';
      reason = 'Picagem com horário inválido';
    } else if (checkOut && !checkIn) {
      kind = 'incomplete';
      reason = 'Saída registada sem entrada';
    } else if (!checkIn && startsAt && now <= startsAt) {
      continue;
    } else if (!planned) {
      kind = 'incomplete';
      reason = 'Horário previsto incompleto';
    } else if (!checkIn) {
      kind = 'missing_entry';
      reason = 'Entrada por registar';
    } else if (now > planned.endsAt) {
      kind = 'missing_exit';
      reason = 'Saída por registar';
      since = planned.endsAt;
    } else continue;

    items.push({
      id: `attendance-${assignment.id}`, assignmentId: assignment.id,
      collaboratorId: assignment.collaboratorId,
      eventId: event.id, eventName: event.name || 'Evento/Serviço',
      clientName: event.client?.name || event.clientName || '',
      collaboratorName: assignment.collaborator?.shortName || assignment.collaborator?.name || 'Colaborador',
      assignmentDate: day, role: assignment.role || '',
      workLocation: event.workLocationsEnabled ? assignment.workLocation?.name || '' : '',
      startTime, endTime, checkIn, checkOut, kind, reason, since: since?.toISOString() || '',
      to: `/services/${event.id}?tab=team&day=${day}`,
    });
  }
  items.sort((a, b) => a.since.localeCompare(b.since)
    || a.collaboratorName.localeCompare(b.collaboratorName, 'pt') || a.assignmentId - b.assignmentId);
  const summary = { missing_entry: 0, missing_exit: 0, incomplete: 0 };
  for (const item of items) summary[item.kind] += 1;
  return { items, total: items.length, summary, checkedAt: now.toISOString(), timeZone };
}

export async function readAttendanceAttention(db, options = {}) {
  const timing = { now: new Date(), timeZone: process.env.APP_TIMEZONE || 'Europe/Lisbon', ...options };
  const assignments = await db.eventAssignment.findMany({
    where: communicationQrCandidateWhere(timing),
    select: {
      id: true, collaboratorId: true, assignmentDate: true, status: true, validationStatus: true, role: true,
      plannedCheckIn: true, plannedCheckOut: true, checkIn: true, checkOut: true,
      collaborator: { select: { name: true, shortName: true } },
      workLocation: { select: { name: true } },
      event: { select: {
        id: true, name: true, date: true, startTime: true, endTime: true, status: true, cancelledDays: true,
        clientName: true, workLocationsEnabled: true, client: { select: { name: true } },
      } },
    },
  });
  return buildAttendanceAttention(assignments, timing);
}
