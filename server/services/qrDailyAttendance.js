import { createHash } from 'node:crypto';
import { isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';
import { communicationAssignmentSchedule } from '../../src/utils/communicationCenter.js';
import { communicationQrWindow } from '../utils/communicationQrWindow.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { readDailyQrToken } from '../utils/qrDailyToken.js';
import { formatServerTime, qrCodeStateForAssignment, qrUsageWindow } from '../utils/qrCheckins.js';
import { publicQrValidation, qrConsultationAccess } from '../utils/qrConsultation.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { publicQrError, qrCheckoutProtection, registerPublicQr } from './qrAttendance.js';

export const QR_SERVICE_SWITCH_DELAY_MS = 2000;
const excludedStatuses = new Set(['cancelled', 'canceled', 'removed', 'missed_justified', 'missed_unjustified']);

function eligible(row) {
  return !excludedStatuses.has(String(row.status || '').toLowerCase())
    && !['cancelled', 'canceled'].includes(String(row.event.status || '').toLowerCase())
    && !isAssignmentOnCancelledDay(row, row.event) && !row.qrCheckCode?.revokedAt;
}

function qrFor(row) {
  return { ...row.qrCheckCode, assignment: row, event: row.event, collaborator: row.collaborator,
    logs: row.qrCheckLogs.filter((log) => log.action === 'check_in') };
}

function plannedWindow(row) {
  return communicationQrWindow({ ...row, checkIn: null, checkOut: null }, row.event);
}

function overlaps(a, b) {
  const first = plannedWindow(a);
  const second = plannedWindow(b);
  return !first || !second || (first.startsAt < second.endsAt && second.startsAt < first.endsAt);
}

async function dailyState(db, token, now, { preview = false, rowFilter } = {}) {
  const identity = readDailyQrToken(token);
  if (!identity) throw publicQrError(404, 'Link diário inválido.', 'QR_INVALID');
  const date = new Date(`${identity.day}T00:00:00Z`);
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const range = { gte: date, lt: nextDay };
  const found = await db.eventAssignment.findMany({
    where: { collaboratorId: identity.collaboratorId, OR: [{ assignmentDate: range }, { assignmentDate: null, event: { date: range } }] },
    include: {
      event: { include: { client: { select: { name: true } } } },
      collaborator: { select: { name: true, shortName: true } }, workLocation: { select: { name: true } }, qrCheckCode: true,
      qrCheckLogs: { orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: 4, select: { action: true, recordedAt: true } },
    },
  });
  const rows = found.filter((row) => eligible(row) && (!rowFilter || rowFilter(row))).sort((a, b) => {
    const first = plannedWindow(a)?.startsAt.getTime() || 0;
    const second = plannedWindow(b)?.startsAt.getTime() || 0;
    return first - second || a.id - b.id;
  });
  if (!rows.length) throw publicQrError(410, 'Não existem serviços disponíveis para este colaborador neste dia.', 'QR_DAY_EMPTY');
  const windows = rows.map((row) => qrUsageWindow({ assignment: row, event: row.event }));
  const consultation = rows.map((row) => qrConsultationAccess({ assignment: row, event: row.event, now }));
  const punchStartsAt = windows[0].startsAt;
  // The reminder can open the link before the service day, but must not authorize a punch.
  const previewStartsAt = Math.min(punchStartsAt.getTime(), ...rows.map((row) => {
    const start = communicationQrWindow(row, row.event)?.startsAt
      || eventStartInstant(identity.day, row.checkIn || communicationAssignmentSchedule(row, row.event).startTime, process.env.APP_TIMEZONE || 'Europe/Lisbon');
    return start ? start.getTime() - 24 * 60 * 60 * 1000 : punchStartsAt.getTime();
  }));
  if (now.getTime() < (preview ? previewStartsAt : punchStartsAt.getTime())) {
    throw publicQrError(400, preview
      ? 'Este link pode ser consultado nas 24 horas anteriores ao primeiro serviço.'
      : 'As picagens só estão disponíveis no dia do serviço.', 'QR_NOT_ACTIVE');
  }
  const expiresAt = preview ? Math.max(...consultation.map((access) => access.consultationExpiresAt.getTime()))
    : Math.max(...windows.map((window) => window.expiresAt.getTime()));
  if (now.getTime() > expiresAt) {
    throw publicQrError(410, preview ? 'O prazo de 31 dias para consultar os serviços deste dia terminou.' : 'Este link diário está expirado.', 'QR_EXPIRED');
  }
  const available = rows.filter((row, index) => now <= windows[index].expiresAt && !(row.checkIn && row.checkOut));
  const opened = available.filter((row) => row.checkIn && !row.checkOut);
  const candidates = opened.length ? opened : available.filter((row) => row === available[0] || overlaps(available[0], row));
  const revision = createHash('sha256').update(JSON.stringify(rows.map((row) => [row.id, row.updatedAt, row.checkIn, row.checkOut, row.status, row.event.updatedAt, row.qrCheckCode?.token]))).digest('hex');
  let switchAvailableAt = 0;
  for (const row of rows) {
    if (!row.checkOut) continue;
    const exit = row.qrCheckLogs.find((log) => log.action === 'check_out' && formatServerTime(log.recordedAt) === row.checkOut);
    if (exit) switchAvailableAt = Math.max(switchAvailableAt, exit.recordedAt.getTime() + QR_SERVICE_SWITCH_DELAY_MS);
  }
  return { identity, rows, candidates, revision, switchAvailableAt, windows, punchStartsAt, consultation };
}

function payload(state, now) {
  const { rows, candidates, identity, revision, switchAvailableAt, windows, punchStartsAt, consultation } = state;
  return {
    scope: 'day', assignmentDate: identity.day,
    timeZone: consultation[0].timeZone,
    readOnly: consultation.every((access) => access.readOnly),
    consultationExpiresAt: new Date(Math.max(...consultation.map((access) => access.consultationExpiresAt.getTime()))).toISOString(),
    collaboratorName: rows[0].collaborator.shortName || rows[0].collaborator.name,
    completed: rows.every((row) => row.checkIn && row.checkOut),
    completedCount: rows.filter((row) => row.checkIn && row.checkOut).length,
    total: rows.length, revision,
    selectionRequired: candidates.length > 1,
    activeAssignmentId: candidates.length === 1 ? candidates[0].id : null,
    candidateIds: candidates.map((row) => row.id),
    punchAvailableAt: punchStartsAt.toISOString(),
    punchAvailableTime: formatServerTime(punchStartsAt),
    punchRetryAfterMs: Math.max(0, punchStartsAt.getTime() - now.getTime()),
    switchRetryAfterMs: Math.max(0, switchAvailableAt - now.getTime()),
    services: rows.map((row, index) => ({
      assignmentId: row.id, eventName: row.event.name,
      clientName: row.event.client?.name || row.event.clientName || '',
      location: row.event.location || '',
      workLocation: row.event.workLocationsEnabled ? row.workLocation?.name || '' : '',
      role: row.role || '', ...communicationAssignmentSchedule(row, row.event),
      checkIn: row.checkIn || '', checkOut: row.checkOut || '',
      ...publicQrValidation(row),
      readOnly: consultation[index].readOnly,
      state: qrCodeStateForAssignment(row),
      expired: now > windows[index].expiresAt,
      ...qrCheckoutProtection(qrFor(row), now),
    })),
  };
}

export async function readDailyQr(db, token, { now = new Date(), rowFilter } = {}) {
  return payload(await dailyState(db, token, now, { preview: true, rowFilter }), now);
}

export async function registerDailyQr(db, token, action, request = {}, { now = new Date(), audit = {}, rowFilter, authorize } = {}) {
  await registerPublicQr(db, token, action, {
    now, audit, serializable: true,
    resolveQr: async (tx) => {
      if (authorize) await authorize(tx);
      const state = await dailyState(tx, token, now, { rowFilter });
      if (!request?.revision || request.revision !== state.revision) {
        throw publicQrError(409, 'Os serviços foram atualizados. Confirma o serviço e tenta novamente.', 'QR_CHANGED');
      }
      const row = state.candidates.find((item) => item.id === Number(request.assignmentId));
      if (!row) throw publicQrError(409, 'Seleciona o serviço disponível antes de registar a picagem.', 'QR_SERVICE_REQUIRED');
      if (action !== qrCodeStateForAssignment(row).nextAction) {
        throw publicQrError(409, 'Esta picagem já foi registada. Confirma o estado atual.', 'QR_CHANGED');
      }
      if (action === 'check_in' && now.getTime() < state.switchAvailableAt) {
        throw publicQrError(409, 'Saída registada. Aguarda um momento antes de entrar no próximo serviço.', 'QR_SERVICE_SWITCH');
      }
      row.qrCheckCode = await ensureAssignmentQr(tx, row);
      if (!row.qrCheckCode || row.qrCheckCode.revokedAt) throw publicQrError(410, 'Este serviço não está disponível.', 'QR_REVOKED');
      return qrFor(row);
    },
  });
  return readDailyQr(db, token, { now, rowFilter });
}
