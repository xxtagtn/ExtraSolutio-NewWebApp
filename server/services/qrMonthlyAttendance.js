import { isAssignmentOnCancelledDay, eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { communicationAssignmentSchedule } from '../../src/utils/communicationCenter.js';
import { monthlyQrCycle, readMonthlyQrToken } from '../utils/qrMonthlyToken.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { communicationQrWindow } from '../utils/communicationQrWindow.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import { qrUsageWindow } from '../utils/qrCheckins.js';
import { publicQrValidation } from '../utils/qrConsultation.js';
import { publicQrError } from './qrAttendance.js';
import { readDailyQr, registerDailyQr } from './qrDailyAttendance.js';

export function monthlyQrEligible(row) {
  return ['confirmed', 'confirmado'].includes(String(row.status || '').toLowerCase())
    && !['cancelled', 'canceled'].includes(String(row.event.status || '').toLowerCase())
    && !isAssignmentOnCancelledDay(row, row.event) && !row.qrCheckCode?.revokedAt;
}

function identity(token, now) {
  const result = readMonthlyQrToken(token, { now });
  if (!result) throw publicQrError(404, 'Link mensal inválido.', 'QR_INVALID');
  if (result.expired) throw publicQrError(410, 'O prazo de consulta deste link terminou. Pede à ExtraSolutio o novo link mensal.', 'QR_EXPIRED');
  return result;
}

export async function monthlyQrRows(db, { now = new Date(), collaboratorId, eventId, cycle = monthlyQrCycle(now) } = {}) {
  const from = new Date(`${cycle.historyFrom}T00:00:00Z`);
  const until = new Date(`${cycle.servicesUntil}T00:00:00Z`);
  // Assignment dates are civil service dates; only the current link's days are listed.
  const range = { gte: from, lt: until };
  const found = await db.eventAssignment.findMany({
    where: {
      ...(collaboratorId ? { collaboratorId } : {}),
      ...(eventId ? { eventId } : {}), status: { in: ['confirmed', 'confirmado'] },
      OR: [{ assignmentDate: range }, { assignmentDate: null, event: { date: range } }],
    },
    include: {
      event: { include: { client: { select: { name: true } } } },
      collaborator: { select: { name: true, shortName: true } }, workLocation: { select: { name: true } }, qrCheckCode: true,
    },
    orderBy: [{ assignmentDate: 'asc' }, { id: 'asc' }],
  });
  return found.filter(monthlyQrEligible).sort((a, b) => {
    const day = eventDayKey(a.assignmentDate || a.event.date).localeCompare(eventDayKey(b.assignmentDate || b.event.date));
    return day || String(communicationAssignmentSchedule(a, a.event).startTime).localeCompare(String(communicationAssignmentSchedule(b, b.event).startTime)) || a.id - b.id;
  });
}

export function monthlyServicePayload(row, now, cycle = monthlyQrCycle(now)) {
  const window = qrUsageWindow({ assignment: row, event: row.event });
  const planned = communicationQrWindow({ ...row, checkIn: null, checkOut: null }, row.event, cycle.timeZone);
  const startsAt = planned?.startsAt || eventStartInstant(row.assignmentDate || row.event.date,
    row.plannedCheckIn || row.event.startTime, cycle.timeZone) || window.startsAt;
  return {
    assignmentId: row.id, assignmentDate: eventDayKey(row.assignmentDate || row.event.date),
    eventName: row.event.name, clientName: row.event.client?.name || row.event.clientName || '',
    role: row.role || '', location: row.event.location || '',
    workLocation: row.event.workLocationsEnabled ? row.workLocation?.name || '' : '',
    ...communicationAssignmentSchedule(row, row.event),
    checkIn: row.checkIn || '', checkOut: row.checkOut || '', ...publicQrValidation(row),
    readOnly: now > cycle.punchExpiresAt || now > window.expiresAt,
    upcoming: !row.checkIn && !row.checkOut && now < startsAt,
    requiresNewLinkForCheckout: !row.checkOut && Boolean(planned && planned.endsAt > cycle.punchExpiresAt),
  };
}

export async function readMonthlyQr(db, token, { now = new Date() } = {}) {
  const { collaboratorId, cycle, consultationOnly } = identity(token, now);
  const rows = await monthlyQrRows(db, { collaboratorId, now, cycle });
  let overnightRows = [];
  // Only an already-started overnight service can bridge months; never add it to monthly history.
  if (!consultationOnly && cycle.day === cycle.historyFrom) {
    const previousDay = new Date(`${cycle.historyFrom}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    overnightRows = (await monthlyQrRows(db, { collaboratorId, now,
      cycle: { ...cycle, historyFrom: previousDay.toISOString().slice(0, 10), servicesUntil: cycle.historyFrom } }))
      .filter((row) => {
        const window = qrUsageWindow({ assignment: row, event: row.event });
        return row.checkIn && now >= window.startsAt && now <= window.expiresAt;
      });
  }
  const availableRows = [...overnightRows, ...rows];
  if (!availableRows.length) throw publicQrError(410, 'Não existem serviços confirmados disponíveis neste período.', 'QR_MONTH_EMPTY');
  // Reuse the daily candidate selection, cooldown and revision for the active day.
  const activeRows = consultationOnly ? [] : availableRows.filter((row) => {
    const window = qrUsageWindow({ assignment: row, event: row.event });
    return now >= window.startsAt && now <= window.expiresAt && !(row.checkIn && row.checkOut);
  });
  const activeRow = activeRows.find((row) => row.checkIn && !row.checkOut) || activeRows[0];
  const activeDay = activeRow ? eventDayKey(activeRow.assignmentDate || activeRow.event.date) : null;
  const active = activeDay ? await readDailyQr(db, createDailyQrToken(collaboratorId, activeDay), { now, rowFilter: monthlyQrEligible }) : null;
  return {
    scope: 'month', collaboratorName: availableRows[0].collaborator.shortName || availableRows[0].collaborator.name,
    timeZone: cycle.timeZone, consultationExpiresAt: cycle.expiresAt.toISOString(), historyFrom: cycle.historyFrom,
    punchExpiresAt: cycle.punchExpiresAt.toISOString(), consultationOnly,
    readOnly: !active, activeDay, active, services: rows.map((row) => monthlyServicePayload(row, now, cycle)),
  };
}

export async function registerMonthlyQr(db, token, action, request = {}, { now = new Date(), audit = {} } = {}) {
  const { collaboratorId, consultationOnly } = identity(token, now);
  if (consultationOnly) throw publicQrError(410, 'Este link permite apenas consultar os horários. Usa o link do mês atual para picar.', 'QR_READ_ONLY');
  const current = await readMonthlyQr(db, token, { now });
  if (!current.activeDay) throw publicQrError(410, 'Não existem serviços disponíveis para picar neste momento.', 'QR_EXPIRED');
  await registerDailyQr(db, createDailyQrToken(collaboratorId, current.activeDay), action, request, {
    now, audit, rowFilter: monthlyQrEligible,
    authorize: () => {
      if (identity(token, now).consultationOnly) throw publicQrError(410, 'Este link permite apenas consulta.', 'QR_READ_ONLY');
    },
  });
  return readMonthlyQr(db, token, { now });
}
