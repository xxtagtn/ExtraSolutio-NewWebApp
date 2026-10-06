import { roundedBillableHours } from '../../src/utils/serviceFinance.js';
import {
  QR_CHECK_ACTIONS,
  formatServerTime,
  qrCheckOutAvailableAt,
  validateQrUsage,
} from '../utils/qrCheckins.js';
import { qrConsultationAccess } from '../utils/qrConsultation.js';
import { isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';

const qrInclude = {
  event: { include: { client: true } },
  assignment: { include: { collaborator: true, event: { include: { client: true } } } },
  collaborator: true,
  logs: {
    where: { action: QR_CHECK_ACTIONS.checkIn },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { recordedAt: true },
  },
};

export function publicQrError(statusCode, message, code = 'QR_ERROR') {
  return Object.assign(new Error(message), { statusCode, code, expose: true });
}

export function qrCheckoutProtection(qrCode, now = new Date()) {
  const availableAt = qrCheckOutAvailableAt({
    event: qrCode.event || qrCode.assignment?.event,
    assignment: qrCode.assignment,
    checkInLog: qrCode.logs?.[0],
  });
  return {
    checkOutAvailableAt: availableAt?.toISOString() || null,
    checkOutAvailableTime: availableAt ? formatServerTime(availableAt) : '',
    checkOutRetryAfterMs: availableAt ? Math.max(0, availableAt.getTime() - now.getTime()) : 0,
  };
}

async function loadPublicQr(client, token) {
  if (!token) throw publicQrError(404, 'QR Code inválido.', 'QR_INVALID');
  const qrCode = await client.qrCheckCode.findUnique({ where: { token }, include: qrInclude });
  if (!qrCode) throw publicQrError(404, 'QR Code inválido.', 'QR_INVALID');
  if (qrCode.revokedAt) throw publicQrError(410, 'Este QR Code foi anulado.', 'QR_REVOKED');
  if (String(qrCode.assignment?.status || '').toLowerCase() === 'cancelled') {
    throw publicQrError(410, 'Este dia do evento foi cancelado.', 'QR_DAY_CANCELLED');
  }
  return qrCode;
}

export async function readPublicQr(client, token, { now = new Date() } = {}) {
  const qrCode = await loadPublicQr(client, token);
  try {
    validateQrUsage({ event: qrCode.event || qrCode.assignment?.event, assignment: qrCode.assignment, now });
  } catch (error) {
    throw publicQrError(error.status || error.statusCode || 400, error.message, error.code || 'QR_INVALID');
  }
  return qrCode;
}

export async function readPublicQrForConsultation(client, token, { now = new Date() } = {}) {
  const qrCode = await loadPublicQr(client, token);
  const event = qrCode.event || qrCode.assignment?.event;
  const assignment = qrCode.assignment;
  if (!assignment || qrCode.collaboratorId !== assignment.collaboratorId || qrCode.eventId !== assignment.eventId) {
    throw publicQrError(410, 'Este link já não corresponde ao serviço atribuído.', 'QR_INVALID');
  }
  if (['cancelled', 'canceled', 'removed', 'missed_justified', 'missed_unjustified'].includes(String(assignment.status || '').toLowerCase())
    || ['cancelled', 'canceled'].includes(String(event?.status || '').toLowerCase()) || isAssignmentOnCancelledDay(assignment, event)) {
    throw publicQrError(410, 'Este serviço já não está disponível.', 'QR_DAY_CANCELLED');
  }
  let access;
  try {
    access = qrConsultationAccess({ event, assignment, now });
  } catch (error) {
    throw publicQrError(error.status || 400, error.message, error.code || 'QR_INVALID');
  }
  if (now < access.punchStartsAt) throw publicQrError(400, 'Este QR Code ainda não está ativo para este dia de serviço.', 'QR_NOT_ACTIVE');
  if (now > access.consultationExpiresAt) throw publicQrError(410, 'O prazo de 31 dias para consultar este serviço terminou.', 'QR_EXPIRED');
  return { qrCode, access };
}

export async function registerPublicQr(prisma, token, action, { now = new Date(), audit = {}, resolveQr, serializable = false } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const qrCode = resolveQr ? await resolveQr(tx) : await readPublicQr(tx, token, { now });
        const assignment = qrCode.assignment;
        // Consultation must never authorize a write, including through a custom resolver.
        try {
          validateQrUsage({ event: qrCode.event || assignment?.event, assignment, now });
        } catch (error) {
          throw publicQrError(error.status || 400, error.message, error.code || 'QR_INVALID');
        }
        const serverTime = formatServerTime(now);
        const data = {};

        if (action === QR_CHECK_ACTIONS.checkIn) {
          if (assignment.checkIn) throw publicQrError(409, 'Entrada já registada.', 'QR_CHECKIN_EXISTS');
          data.checkIn = serverTime;
        } else if (action === QR_CHECK_ACTIONS.checkOut) {
          if (!assignment.checkIn) throw publicQrError(400, 'Regista primeiro a entrada.', 'QR_CHECKIN_REQUIRED');
          if (assignment.checkOut) throw publicQrError(409, 'Saída já registada.', 'QR_CHECKOUT_EXISTS');
          const protection = qrCheckoutProtection(qrCode, now);
          if (protection.checkOutRetryAfterMs > 0) {
            throw publicQrError(409,
              `Entrada já registada. Só podes registar a saída 30 minutos após a entrada, a partir das ${protection.checkOutAvailableTime}.`,
              'QR_CHECKOUT_TOO_EARLY');
          }
          const hoursWorked = roundedBillableHours(assignment.checkIn, serverTime);
          Object.assign(data, {
            checkOut: serverTime,
            hoursWorked,
            staffPayableHours: hoursWorked,
            totalPay: Number((hoursWorked * Number(assignment.hourlyRate || 0)).toFixed(2)),
          });
        } else {
          throw publicQrError(400, 'Ação inválida para este QR Code.', 'QR_ACTION_INVALID');
        }

        // Compare and write atomically: a concurrent punch/admin correction must
        // not be overwritten by a request that read an older assignment.
        const changed = await tx.eventAssignment.updateMany({
          where: {
            id: assignment.id,
            checkIn: assignment.checkIn,
            checkOut: assignment.checkOut,
            updatedAt: assignment.updatedAt,
            qrCheckCode: { is: { token: qrCode.token, revokedAt: null } },
          },
          data,
        });
        if (changed.count !== 1) {
          throw publicQrError(409, 'As picagens foram alteradas. Confirma os horários atualizados e tenta novamente.', 'QR_CHANGED');
        }
        await tx.qrCheckLog.create({
          data: {
            qrCodeId: qrCode.id,
            eventId: qrCode.eventId,
            assignmentId: assignment.id,
            collaboratorId: qrCode.collaboratorId,
            action,
            recordedAt: now,
            ip: audit.ip || '',
            userAgent: audit.userAgent || '',
          },
        });
        return tx.qrCheckCode.findUnique({ where: { id: qrCode.id }, include: qrInclude });
      }, serializable ? { isolationLevel: 'Serializable' } : undefined);
    } catch (error) {
      // Retry transaction conflicts against fresh state, not the previous action's data.
      if (error.code !== 'P2034') throw error;
      if (attempt >= 2) {
        throw publicQrError(409, 'As picagens foram alteradas. Confirma os horários atualizados e tenta novamente.', 'QR_CHANGED');
      }
    }
  }
}
