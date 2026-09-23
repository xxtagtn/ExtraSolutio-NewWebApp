import { buildCommunicationCenter, communicationSummary } from '../../src/utils/communicationCenter.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { buildPaginatedPayload, parsePaginationQuery } from '../utils/listQuery.js';

const collaboratorSelect = { name: true, shortName: true, phone: true };
const eventSelect = {
  id: true, name: true, clientName: true, date: true, status: true,
  startTime: true, endTime: true, client: { select: { name: true } },
};
const assignmentSelect = {
  id: true, eventId: true, collaboratorId: true, status: true, role: true,
  assignmentDate: true, plannedCheckIn: true, plannedCheckOut: true, checkIn: true, checkOut: true,
  whatsappEnabled: true, collaborator: { select: collaboratorSelect }, event: { select: eventSelect },
};

function tasksFromAssignments(assignments, options) {
  return buildCommunicationCenter({
    services: assignments.map((assignment) => ({ ...assignment.event, assignments: [assignment] })),
  }, options);
}

function matchesFilters(task, query) {
  const search = String(query.search || '').trim().toLowerCase();
  if (search && ![task.collaboratorName, task.eventName, task.clientName, task.role, task.rawPhone, task.phone]
    .join(' ').toLowerCase().includes(search)) return false;
  if (query.kind && query.kind !== 'all' && task.kind !== query.kind) return false;
  if (query.eventId && query.eventId !== 'all' && String(task.serviceId) !== String(query.eventId)) return false;
  const state = query.state || 'open';
  if (state === 'open') return !['confirmed', 'unavailable'].includes(task.state);
  return state === 'all' || state === task.state;
}

export function communicationPagination(query = {}, total) {
  const { page: requested, pageSize } = parsePaginationQuery({ page: 1, pageSize: 25, ...query }, { maxPageSize: 100 });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function readCommunicationPage(db, query = {}, { now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon' } = {}) {
  const options = { today: now, resolveStart: (day, time) => eventStartInstant(day, time, timeZone) };
  // States are derived from the latest log of the current message type. Read only
  // that log's metadata for counts/filtering, then hydrate messages for this page.
  const groups = await Promise.all(['confirmation', 'reminder_24h'].map((type) => db.eventAssignment.findMany({
    where: {
      status: type === 'reminder_24h' ? { in: ['confirmed', 'confirmado'] } : { notIn: ['confirmed', 'confirmado'] },
      event: { status: { not: 'cancelled' } },
    },
    select: {
      ...assignmentSelect,
      communicationLogs: {
        where: { type }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
        select: { id: true, assignmentId: true, type: true, status: true, createdAt: true },
      },
    },
  })));
  const tasks = tasksFromAssignments(groups.flat(), { ...options, includeMessage: false });
  const filtered = tasks.filter((task) => matchesFilters(task, query));
  const { page, pageSize, skip } = communicationPagination(query, filtered.length);
  const pageTasks = filtered.slice(skip, skip + pageSize);
  const ids = pageTasks.map((task) => task.assignmentId);
  const logIds = pageTasks.flatMap((task) => task.latestLog ? [task.latestLog.id] : []);
  const details = ids.length ? await db.eventAssignment.findMany({
    where: { id: { in: ids } }, take: pageSize,
    select: {
      ...assignmentSelect,
      event: { select: { ...eventSelect, uniform: true, location: true } },
      communicationLogs: {
        where: { id: { in: logIds } },
        select: { id: true, assignmentId: true, type: true, status: true, createdAt: true, message: true },
      },
    },
  }) : [];
  const itemsById = new Map(tasksFromAssignments(details, options).map((task) => [task.id, task]));
  const events = new Map();
  for (const task of tasks) {
    if (!events.has(task.serviceId)) events.set(task.serviceId, { id: String(task.serviceId), name: task.eventName });
  }
  return {
    ...buildPaginatedPayload({ items: pageTasks.map((task) => itemsById.get(task.id)).filter(Boolean), total: filtered.length, page, pageSize }),
    summary: communicationSummary(tasks),
    events: [...events.values()],
  };
}
