import { eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { eventStartInstant } from './eventTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function nextDay(day, offset = 1) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return eventDayKey(date);
}

function minutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function communicationQrWindow(assignment, event, timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  let day = eventDayKey(assignment.assignmentDate || event.date);
  const plannedStart = assignment.plannedCheckIn || event.startTime;
  const plannedEnd = assignment.plannedCheckOut || event.endTime;
  const start = assignment.checkIn || plannedStart;
  const end = assignment.checkOut || plannedEnd;
  const startMinutes = minutes(start);
  const endMinutes = minutes(end);
  if (!day || startMinutes === null || endMinutes === null) return null;

  // A late entry after midnight still belongs to the assigned overnight shift.
  if (assignment.checkIn && minutes(plannedStart) !== null && minutes(plannedEnd) !== null
    && minutes(plannedEnd) < minutes(plannedStart) && startMinutes < minutes(plannedStart)
    && startMinutes <= minutes(plannedEnd)) day = nextDay(day);

  const startsAt = eventStartInstant(day, start, timeZone);
  const endsAt = eventStartInstant(endMinutes < startMinutes ? nextDay(day) : day, end, timeZone);
  if (!startsAt || !endsAt) return null;
  return {
    startsAt, endsAt,
    visibleFrom: new Date(startsAt.getTime() - DAY_MS),
    visibleUntil: new Date(endsAt.getTime() + DAY_MS),
  };
}

export function isCommunicationQrRelevant(assignment, event, { now = new Date(), timeZone } = {}) {
  const window = communicationQrWindow(assignment, event, timeZone);
  const instant = new Date(now).getTime();
  return Boolean(window && instant >= window.visibleFrom.getTime() && instant < window.visibleUntil.getTime());
}

export function communicationQrCandidateWhere({ now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon' } = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const day = eventDayKey(Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])));
  // Bound the lightweight SQL scan. Exact per-person timestamps are checked next;
  // the calendar margin covers overnight shifts and daylight-saving transitions.
  const range = { gte: new Date(`${nextDay(day, -3)}T00:00:00Z`), lt: new Date(`${nextDay(day, 3)}T00:00:00Z`) };
  return {
    status: { not: 'cancelled' },
    OR: [
      { assignmentDate: range },
      { assignmentDate: null, event: { date: range } },
    ],
  };
}
