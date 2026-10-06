import { eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { readMonthlyPunchToken } from '../utils/qrMonthlyToken.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import { publicQrPlannedSchedule } from '../utils/qrConsultation.js';
import { formatServerTime, qrUsageWindow } from '../utils/qrCheckins.js';
import { communicationQrWindow } from '../utils/communicationQrWindow.js';
import { monthlyQrEligible, monthlyQrRows } from './qrMonthlyAttendance.js';
import { publicDailyPunchPayload, readDailyQr, registerDailyQr } from './qrDailyAttendance.js';
import { publicQrError } from './qrAttendance.js';

function identity(token, now) {
  if (!String(token || '').startsWith('month2.')) {
    throw publicQrError(410, 'Os links mensais antigos foram desativados. Pede o novo link de picagens.', 'QR_RETIRED');
  }
  const result = readMonthlyPunchToken(token, { now });
  if (!result) throw publicQrError(404, 'Link mensal inválido.', 'QR_INVALID');
  if (result.notActive) throw publicQrError(400, 'Este link só está disponível no mês correspondente.', 'QR_NOT_ACTIVE');
  if (result.expired && result.cycle.day !== result.cycle.servicesUntil) throw expiredLink();
  return result;
}

function expiredLink() {
  return publicQrError(410, 'Este link mensal está expirado. Pede o link do mês atual.', 'QR_EXPIRED');
}

function lastMonthDay(cycle) {
  const day = new Date(`${cycle.servicesUntil}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function closingShift(row, cycle, now, requireOpen = true) {
  if (!monthlyQrEligible(row) || !row.checkIn || (requireOpen && row.checkOut)
    || eventDayKey(row.assignmentDate || row.event.date) !== lastMonthDay(cycle)) return false;
  const window = qrUsageWindow({ assignment: row, event: row.event });
  if (window.expiresAt <= cycle.expiresAt || now > window.expiresAt) return false;
  const log = row.qrCheckLogs?.find((entry) => entry.action === 'check_in');
  const entryAt = log && formatServerTime(log.recordedAt, cycle.timeZone) === row.checkIn
    ? log.recordedAt : communicationQrWindow({ ...row, checkOut: null }, row.event, cycle.timeZone)?.startsAt;
  return Boolean(entryAt && entryAt >= window.startsAt && entryAt <= cycle.expiresAt);
}

async function closingRows(db, collaboratorId, cycle, now) {
  return (await monthlyQrRows(db, { collaboratorId, now, includeEntryLogs: true,
    cycle: { ...cycle, historyFrom: lastMonthDay(cycle) } })).filter((row) => closingShift(row, cycle, now));
}

function pending(row, now) {
  return !(row.checkIn && row.checkOut) && now <= qrUsageWindow({ assignment: row, event: row.event }).expiresAt;
}

function servicePayload(row) {
  const planned = publicQrPlannedSchedule(row, row.event);
  return {
    assignmentId: row.id, assignmentDate: eventDayKey(row.assignmentDate || row.event.date),
    eventName: row.event.name, role: row.role || '', location: row.event.location || '',
    workLocation: row.event.workLocationsEnabled ? row.workLocation?.name || '' : '',
    startTime: planned.plannedCheckIn, endTime: planned.plannedCheckOut,
    inProgress: Boolean(row.checkIn && !row.checkOut),
  };
}

export async function readMonthlyPunchQr(db, token, { now = new Date() } = {}) {
  const { collaboratorId, cycle, expired } = identity(token, now);
  const rows = expired ? await closingRows(db, collaboratorId, cycle, now) : await monthlyQrRows(db, { collaboratorId, now, cycle });
  if (expired && !rows.length) throw expiredLink();
  let overnight = [];
  // The new month's link may finish an open overnight shift, within its original window.
  if (!expired && cycle.day === cycle.historyFrom) {
    const previous = new Date(`${cycle.historyFrom}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    overnight = (await monthlyQrRows(db, { collaboratorId, now,
      cycle: { ...cycle, historyFrom: previous.toISOString().slice(0, 10), servicesUntil: cycle.historyFrom } }))
      .filter((row) => row.checkIn && !row.checkOut && pending(row, now));
  }
  const all = [...overnight, ...rows];
  if (!all.length) throw publicQrError(410, 'Não existem serviços confirmados disponíveis neste mês.', 'QR_MONTH_EMPTY');
  const remaining = all.filter((row) => pending(row, now));
  const available = remaining.filter((row) => now >= qrUsageWindow({ assignment: row, event: row.event }).startsAt);
  const current = available.find((row) => row.checkIn && !row.checkOut) || available[0];
  const activeDay = current ? eventDayKey(current.assignmentDate || current.event.date) : null;
  const active = activeDay ? publicDailyPunchPayload(await readDailyQr(db, createDailyQrToken(collaboratorId, activeDay),
    { now, rowFilter: expired ? (row) => closingShift(row, cycle, now, false) : monthlyQrEligible })) : null;
  return {
    scope: 'month', collaboratorName: all[0].collaborator.shortName || all[0].collaborator.name,
    timeZone: cycle.timeZone, monthFrom: cycle.historyFrom, expiresAt: cycle.expiresAt.toISOString(),
    checkoutOnly: expired,
    activeDay, active, services: remaining.map(servicePayload),
  };
}

export async function registerMonthlyPunchQr(db, token, action, request = {}, { now = new Date(), audit = {} } = {}) {
  const { collaboratorId, cycle, expired } = identity(token, now);
  if (expired && action !== 'check_out') throw expiredLink();
  const current = await readMonthlyPunchQr(db, token, { now });
  if (!current.activeDay) throw publicQrError(409, 'Não existem serviços disponíveis para picar neste momento.', 'QR_NOT_ACTIVE');
  await registerDailyQr(db, createDailyQrToken(collaboratorId, current.activeDay), action, request, {
    now, audit, rowFilter: expired ? (row) => closingShift(row, cycle, now, false) : monthlyQrEligible,
    authorize: async (tx) => {
      identity(token, now);
      if (expired && !(await closingRows(tx, collaboratorId, cycle, now)).some((row) => row.id === Number(request.assignmentId))) {
        throw expiredLink();
      }
    },
  });
  if (expired) {
    try {
      return await readMonthlyPunchQr(db, token, { now });
    } catch (error) {
      if (error.code !== 'QR_EXPIRED') throw error;
      // A successful checkout must not be reported as a failed POST when it closes the link.
      return { ...current, activeDay: null, active: null, services: [], closed: true };
    }
  }
  return readMonthlyPunchQr(db, token, { now });
}
