import { eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { buildPaginatedPayload } from '../utils/listQuery.js';
import { communicationPagination } from './communicationPage.js';

export async function readQrCodesPage(db, eventId, query = {}) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, date: true, endDate: true, clientName: true, status: true, client: { select: { name: true } } },
  });
  if (!event) return null;
  const index = await db.eventAssignment.findMany({
    where: { eventId },
    select: {
      id: true, collaboratorId: true, status: true, assignmentDate: true, role: true,
      plannedCheckIn: true, checkIn: true, checkOut: true,
      collaborator: { select: { name: true, shortName: true } },
    },
  });
  const eligible = index.filter((row) => row.collaboratorId && String(row.status || '').toLowerCase() !== 'cancelled');
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
