import { Router } from 'express';
import os from 'node:os';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { readQrCodesPage, readRelevantQrEvents } from '../services/qrCodesPage.js';
import { communicationAssignmentSchedule } from '../../src/utils/communicationCenter.js';
import { qrCheckoutProtection, readPublicQr, registerPublicQr } from '../services/qrAttendance.js';
import { ensureAssignmentQr } from '../services/qrCodeGeneration.js';
import { readDailyQr, registerDailyQr } from '../services/qrDailyAttendance.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import {
  QR_CHECK_ACTIONS,
  qrCodeStateForAssignment,
  requestAuditMeta,
  resolveQrPublicBaseUrl,
} from '../utils/qrCheckins.js';

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

export async function ensureQrCodeForAssignment(assignmentOrId) {
  return ensureAssignmentQr(prisma, assignmentOrId);
}

export async function ensureQrCodeForAssignmentId(assignmentId) {
  return ensureQrCodeForAssignment(assignmentId);
}

function qrRowPayload(req, assignment, qrCode) {
  const collaborator = assignment.collaborator || {};
  const state = qrCodeStateForAssignment(assignment);
  const event = assignment.event || {};
  const schedule = communicationAssignmentSchedule(assignment, event);
  return {
    id: qrCode.id,
    assignmentId: assignment.id,
    eventId: assignment.eventId,
    eventName: event.name || '',
    clientName: event.client?.name || event.clientName || '',
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    collaboratorId: assignment.collaboratorId,
    collaboratorName: collaborator.shortName || collaborator.name || 'Colaborador',
    collaboratorFullName: collaborator.name || '',
    nif: collaborator.nif || '',
    role: assignment.role || '',
    assignmentDate: assignment.assignmentDate || assignment.event?.date || qrCode.eventDate,
    plannedCheckIn: assignment.plannedCheckIn,
    plannedCheckOut: assignment.plannedCheckOut,
    checkIn: assignment.checkIn,
    checkOut: assignment.checkOut,
    state,
    qrScope: 'day',
    qrUrl: `${publicBaseUrl(req)}/qr/day/${createDailyQrToken(assignment.collaboratorId, schedule.date)}`,
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
    clientName: event.client?.name || event.clientName || '',
    assignmentDate: assignment.assignmentDate || event.date || null,
    role: assignment.role || '',
    plannedCheckIn: assignment.plannedCheckIn || '',
    plannedCheckOut: assignment.plannedCheckOut || '',
    checkIn: assignment.checkIn || '',
    checkOut: assignment.checkOut || '',
    completed: Boolean(assignment.checkIn && assignment.checkOut),
    ...qrCheckoutProtection(qrCode),
    qrUrl: publicQrUrl(req, qrCode.token),
  };
}

export const qrPublicRouter = Router();
export const qrCodesRouter = Router();

qrCodesRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

qrPublicRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

qrPublicRouter.get('/day/:token', asyncHandler(async (req, res) => {
  res.json(await readDailyQr(prisma, req.params.token));
}));

for (const [path, action] of [['check-in', QR_CHECK_ACTIONS.checkIn], ['check-out', QR_CHECK_ACTIONS.checkOut]]) {
  qrPublicRouter.post(`/day/:token/${path}`, asyncHandler(async (req, res) => {
    res.json(await registerDailyQr(prisma, req.params.token, action, req.body, { audit: requestAuditMeta(req) }));
  }));
}

qrPublicRouter.get('/:token', asyncHandler(async (req, res) => {
  const qrCode = await readPublicQr(prisma, req.params.token);
  res.json(publicPayload(req, qrCode));
}));

qrPublicRouter.post('/:token/check-in', asyncHandler(async (req, res) => {
  const updated = await registerPublicQr(prisma, req.params.token, QR_CHECK_ACTIONS.checkIn, { audit: requestAuditMeta(req) });
  res.json(publicPayload(req, updated));
}));

qrPublicRouter.post('/:token/check-out', asyncHandler(async (req, res) => {
  const updated = await registerPublicQr(prisma, req.params.token, QR_CHECK_ACTIONS.checkOut, { audit: requestAuditMeta(req) });
  res.json(publicPayload(req, updated));
}));

qrCodesRouter.get('/events', asyncHandler(async (_req, res) => {
  res.json(await readRelevantQrEvents(prisma, { now: new Date() }));
}));

qrCodesRouter.get('/events/:eventId', asyncHandler(async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'ID inválido.' });

  const page = await readQrCodesPage(prisma, eventId, req.query);
  if (!page) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  const { items: assignments, event, ...pagination } = page;

  const rows = [];
  for (const assignment of assignments) {
    const qrCode = await ensureQrCodeForAssignment({
      ...assignment,
      event,
      qrCheckCode: assignment.qrCheckCode,
    });
    rows.push(qrRowPayload(req, { ...assignment, event }, qrCode));
  }

  res.json({
    ...pagination,
    event,
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
  if (String(assignment.status || '').toLowerCase() === 'cancelled') {
    return res.status(410).json({ message: 'Este dia do evento foi cancelado.' });
  }
  const qrCode = await ensureQrCodeForAssignment(assignment);
  res.json(qrRowPayload(req, assignment, qrCode));
}));
