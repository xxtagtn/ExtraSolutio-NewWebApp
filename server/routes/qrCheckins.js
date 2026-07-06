import { Router } from 'express';
import os from 'node:os';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { roundedBillableHours } from '../../src/utils/serviceFinance.js';
import {
  QR_CHECK_ACTIONS,
  formatServerTime,
  generateQrToken,
  qrCodeStateForAssignment,
  qrUsageWindow,
  requestAuditMeta,
  resolveQrPublicBaseUrl,
  validateQrUsage,
} from '../utils/qrCheckins.js';

const qrInclude = {
  event: { include: { client: true } },
  assignment: { include: { collaborator: true, event: { include: { client: true } } } },
  collaborator: true,
};

function publicError(statusCode, message, code = 'QR_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function parseId(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function publicBaseUrl(req) {
  return resolveQrPublicBaseUrl({
    configured: process.env.APP_PUBLIC_URL || process.env.VITE_APP_PUBLIC_URL || '',
    origin: req.get?.('origin') || '',
    referer: req.get?.('referer') || '',
    protocol: req.protocol,
    host: req.get('host'),
  }, os.networkInterfaces());
}

function publicQrUrl(req, token) {
  return `${publicBaseUrl(req)}/qr/${encodeURIComponent(token)}`;
}

function eventDateForQr(assignment, event) {
  return assignment.assignmentDate || event.date || null;
}

function shouldRegenerateToken(existing, assignment, event) {
  if (!existing) return true;
  const nextDate = eventDateForQr(assignment, event);
  return existing.eventId !== assignment.eventId
    || existing.assignmentId !== assignment.id
    || existing.collaboratorId !== assignment.collaboratorId
    || String(existing.eventDate || '') !== String(nextDate || '');
}

async function createUniqueQrCode(data) {
  for (let attempts = 0; attempts < 5; attempts += 1) {
    try {
      return await prisma.qrCheckCode.create({
        data: { ...data, token: generateQrToken() },
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }
  throw publicError(500, 'Não foi possível gerar um QR Code único.', 'QR_TOKEN_COLLISION');
}

export async function ensureQrCodeForAssignment(assignmentOrId) {
  const id = typeof assignmentOrId === 'object' ? assignmentOrId?.id : assignmentOrId;
  if (!id) return null;

  const assignment = typeof assignmentOrId === 'object' && assignmentOrId?.event && assignmentOrId?.collaborator
    ? assignmentOrId
    : await prisma.eventAssignment.findUnique({
      where: { id },
      include: { event: true, collaborator: true, qrCheckCode: true },
    });

  if (!assignment?.id || !assignment.collaboratorId || !assignment.eventId) return null;

  const event = assignment.event || await prisma.event.findUnique({ where: { id: assignment.eventId } });
  if (!event) return null;

  const { expiresAt } = qrUsageWindow({ event, assignment });
  const eventDate = eventDateForQr(assignment, event);
  const existing = assignment.qrCheckCode || await prisma.qrCheckCode.findUnique({
    where: { assignmentId: assignment.id },
  });

  const baseData = {
    eventId: assignment.eventId,
    assignmentId: assignment.id,
    collaboratorId: assignment.collaboratorId,
    eventDate,
    expiresAt,
    revokedAt: null,
  };

  if (!existing) return createUniqueQrCode(baseData);

  return prisma.qrCheckCode.update({
    where: { id: existing.id },
    data: {
      ...baseData,
      ...(shouldRegenerateToken(existing, assignment, event) ? { token: generateQrToken() } : {}),
    },
  });
}

export async function ensureQrCodeForAssignmentId(assignmentId) {
  return ensureQrCodeForAssignment(assignmentId);
}

function qrRowPayload(req, assignment, qrCode) {
  const collaborator = assignment.collaborator || {};
  const state = qrCodeStateForAssignment(assignment);
  return {
    id: qrCode.id,
    assignmentId: assignment.id,
    eventId: assignment.eventId,
    collaboratorId: assignment.collaboratorId,
    collaboratorName: collaborator.shortName || collaborator.name || 'Colaborador',
    collaboratorFullName: collaborator.name || '',
    nif: collaborator.nif || '',
    role: assignment.role || '',
    assignmentDate: assignment.assignmentDate,
    plannedCheckIn: assignment.plannedCheckIn,
    plannedCheckOut: assignment.plannedCheckOut,
    checkIn: assignment.checkIn,
    checkOut: assignment.checkOut,
    state,
    qrUrl: publicQrUrl(req, qrCode.token),
    expiresAt: qrCode.expiresAt,
  };
}

function publicPayload(req, qrCode) {
  const assignment = qrCode.assignment;
  const event = qrCode.event || assignment?.event || {};
  const collaborator = qrCode.collaborator || assignment?.collaborator || {};
  const state = qrCodeStateForAssignment(assignment);

  return {
    token: qrCode.token,
    state,
    collaboratorName: collaborator.shortName || collaborator.name || 'Colaborador',
    eventName: event.name || 'Evento/Serviço',
    clientName: event.client?.name || '',
    assignmentDate: assignment.assignmentDate || event.date || null,
    role: assignment.role || '',
    plannedCheckIn: assignment.plannedCheckIn || '',
    plannedCheckOut: assignment.plannedCheckOut || '',
    checkIn: assignment.checkIn || '',
    checkOut: assignment.checkOut || '',
    completed: Boolean(assignment.checkIn && assignment.checkOut),
    qrUrl: publicQrUrl(req, qrCode.token),
  };
}

async function loadQrCodeByToken(token) {
  if (!token) throw publicError(404, 'QR Code inválido.', 'QR_INVALID');
  const qrCode = await prisma.qrCheckCode.findUnique({
    where: { token },
    include: qrInclude,
  });
  if (!qrCode) throw publicError(404, 'QR Code inválido.', 'QR_INVALID');
  if (qrCode.revokedAt) throw publicError(410, 'Este QR Code foi anulado.', 'QR_REVOKED');
  return qrCode;
}

function validatePublicQr(qrCode) {
  try {
    validateQrUsage({
      event: qrCode.event || qrCode.assignment?.event,
      assignment: qrCode.assignment,
      now: new Date(),
    });
  } catch (error) {
    throw publicError(error.status || error.statusCode || 400, error.message, error.code || 'QR_INVALID');
  }
}

async function registerQrAction(req, qrCode, action) {
  const assignment = qrCode.assignment;
  const now = new Date();
  const serverTime = formatServerTime(now);
  const audit = requestAuditMeta(req);
  const updateData = {};

  if (action === QR_CHECK_ACTIONS.checkIn) {
    if (assignment.checkIn) throw publicError(409, 'Entrada já registada.', 'QR_CHECKIN_EXISTS');
    updateData.checkIn = serverTime;
  } else if (action === QR_CHECK_ACTIONS.checkOut) {
    if (!assignment.checkIn) throw publicError(400, 'Regista primeiro a entrada.', 'QR_CHECKIN_REQUIRED');
    if (assignment.checkOut) throw publicError(409, 'Saída já registada.', 'QR_CHECKOUT_EXISTS');
    const hoursWorked = roundedBillableHours(assignment.checkIn, serverTime);
    const hourlyRate = Number(assignment.hourlyRate || 0);
    updateData.checkOut = serverTime;
    updateData.hoursWorked = hoursWorked;
    updateData.staffPayableHours = hoursWorked;
    updateData.totalPay = Number((hoursWorked * hourlyRate).toFixed(2));
  } else {
    throw publicError(400, 'Ação inválida para este QR Code.', 'QR_ACTION_INVALID');
  }

  await prisma.$transaction([
    prisma.eventAssignment.update({
      where: { id: assignment.id },
      data: updateData,
    }),
    prisma.qrCheckLog.create({
      data: {
        qrCodeId: qrCode.id,
        eventId: qrCode.eventId,
        assignmentId: qrCode.assignmentId,
        collaboratorId: qrCode.collaboratorId,
        action,
        recordedAt: now,
        ip: audit.ip,
        userAgent: audit.userAgent,
      },
    }),
  ]);

  return prisma.qrCheckCode.findUnique({
    where: { id: qrCode.id },
    include: qrInclude,
  });
}

export const qrPublicRouter = Router();
export const qrCodesRouter = Router();

qrPublicRouter.get('/:token', asyncHandler(async (req, res) => {
  const qrCode = await loadQrCodeByToken(req.params.token);
  validatePublicQr(qrCode);
  res.json(publicPayload(req, qrCode));
}));

qrPublicRouter.post('/:token/check-in', asyncHandler(async (req, res) => {
  const qrCode = await loadQrCodeByToken(req.params.token);
  validatePublicQr(qrCode);
  const updated = await registerQrAction(req, qrCode, QR_CHECK_ACTIONS.checkIn);
  res.json(publicPayload(req, updated));
}));

qrPublicRouter.post('/:token/check-out', asyncHandler(async (req, res) => {
  const qrCode = await loadQrCodeByToken(req.params.token);
  validatePublicQr(qrCode);
  const updated = await registerQrAction(req, qrCode, QR_CHECK_ACTIONS.checkOut);
  res.json(publicPayload(req, updated));
}));

qrCodesRouter.get('/events/:eventId', asyncHandler(async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'ID inválido.' });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      client: true,
      assignments: {
        include: {
          collaborator: true,
          qrCheckCode: true,
        },
      },
    },
  });

  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });

  const assignments = event.assignments
    .filter((assignment) => assignment.collaboratorId)
    .sort((a, b) => (
      String(a.assignmentDate || '').localeCompare(String(b.assignmentDate || ''))
      || String(a.role || '').localeCompare(String(b.role || ''), 'pt')
      || String(a.collaborator?.shortName || a.collaborator?.name || '').localeCompare(String(b.collaborator?.shortName || b.collaborator?.name || ''), 'pt')
      || String(a.plannedCheckIn || '').localeCompare(String(b.plannedCheckIn || ''))
    ));

  const rows = [];
  for (const assignment of assignments) {
    const qrCode = await ensureQrCodeForAssignment({
      ...assignment,
      event,
      qrCheckCode: assignment.qrCheckCode,
    });
    rows.push(qrRowPayload(req, assignment, qrCode));
  }

  res.json({
    event: {
      id: event.id,
      name: event.name,
      clientName: event.client?.name || '',
      date: event.date,
      endDate: event.endDate,
      status: event.status,
    },
    rows,
  });
}));

qrCodesRouter.get('/assignments/:assignmentId', asyncHandler(async (req, res) => {
  const assignmentId = parseId(req.params.assignmentId);
  if (!assignmentId) return res.status(400).json({ message: 'ID inválido.' });
  const assignment = await prisma.eventAssignment.findUnique({
    where: { id: assignmentId },
    include: { event: { include: { client: true } }, collaborator: true, qrCheckCode: true },
  });
  if (!assignment) return res.status(404).json({ message: 'Colaborador do evento não encontrado.' });
  const qrCode = await ensureQrCodeForAssignment(assignment);
  res.json(qrRowPayload(req, assignment, qrCode));
}));
