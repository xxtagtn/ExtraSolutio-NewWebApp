import { eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { buildPaginatedPayload } from '../utils/listQuery.js';
import { communicationPagination } from './communicationPage.js';
import { communicationQrCandidateWhere, isCommunicationQrRelevant } from '../utils/communicationQrWindow.js';

const eventSelect = { id: true, name: true, date: true, endDate: true, startTime: true, endTime: true, clientName: true, status: true, client: { select: { name: true } } };
const scheduleSelect = { assignmentDate: true, plannedCheckIn: true, plannedCheckOut: true, checkIn: true, checkOut: true };

export async function readRelevantQrEvents(db, options = {}) {
  const timing = { ...options, now: options.now || new Date() };
  const assignments = await db.eventAssignment.findMany({
    where: communicationQrCandidateWhere(timing),
    select: { ...scheduleSelect, eventId: true, status: true, event: { select: eventSelect } },
  });
  const events = new Map();
  for (const assignment of assignments) {
    if (String(assignment.status || '').toLowerCase() !== 'cancelled'
      && !events.has(assignment.eventId) && isCommunicationQrRelevant(assignment, assignment.event, timing)) {
      const event = assignment.event;
      events.set(event.id, { id: String(event.id), name: event.name, date: event.date, clientName: event.client?.name || event.clientName || '' });
    }
  }
  return [...events.values()].sort((a, b) => new Date(a.date) - new Date(b.date) || a.name.localeCompare(b.name, 'pt') || Number(a.id) - Number(b.id));
}

export async function readQrCodesPage(db, eventId, query = {}, options = {}) {
  const timing = { ...options, now: options.now || new Date() };
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: eventSelect,
  });
  if (!event) return null;
  const index = await db.eventAssignment.findMany({
    where: { eventId, ...communicationQrCandidateWhere(timing) },
    select: {
      id: true, collaboratorId: true, status: true, role: true,
      ...scheduleSelect,
      collaborator: { select: { name: true, shortName: true } },
    },
  });
  const eligible = index.filter((row) => row.collaboratorId && String(row.status || '').toLowerCase() !== 'cancelled'
    && isCommunicationQrRelevant(row, event, timing));
  eligible.sort((a, b) => (
    eventDayKey(a.assignmentDate || event.date).localeCompare(eventDayKey(b.assignmentDate || event.date))
    || String(a.role || '').localeCompare(String(b.role || ''), 'pt')
    || String(a.collaborator?.shortName || a.collaborator?.name || '').localeCompare(String(b.collaborator?.shortName || b.collaborator?.name || ''), 'pt')
    || String(a.plannedCheckIn || '').localeCompare(String(b.plannedCheckIn || ''))
    || a.id - b.id
  ));
  const { page, pageSize, skip } = communicationPagination(query, eligible.length);
  const ids = eligible.slice(skip, skip + pageSize).map((row) => row.id);
  const assignments = ids.length ? await db.eventAssignment.findMany({
    where: { id: { in: ids } }, take: pageSize,
    select: {
      id: true, eventId: true, collaboratorId: true, status: true, assignmentDate: true,
      role: true, plannedCheckIn: true, plannedCheckOut: true, checkIn: true, checkOut: true,
      collaborator: { select: { name: true, shortName: true, nif: true } }, qrCheckCode: true,
    },
  }) : [];
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return {
    ...buildPaginatedPayload({ items: ids.map((id) => byId.get(id)).filter(Boolean), total: eligible.length, page, pageSize }),
    event: { ...event, clientName: event.client?.name || event.clientName || '' },
    summary: {
      total: eligible.length,
      entries: eligible.filter((row) => row.checkIn).length,
      completed: eligible.filter((row) => row.checkIn && row.checkOut).length,
    },
  };
}
