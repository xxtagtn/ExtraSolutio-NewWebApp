import { randomBytes } from 'node:crypto';
import { requireActiveQrCollaborator, qrPageNotFound } from './collaboratorQrAccess.js';
import { createMonthlyPunchToken, monthlyPunchCycle } from '../utils/qrMonthlyToken.js';
import { readMonthlyPunchQr, registerMonthlyPunchQr } from './qrMonthlyPunching.js';
import { communicationPagination } from './communicationPage.js';
import { buildPaginatedPayload } from '../utils/listQuery.js';
import { monthlyQrEligible } from './qrMonthlyAttendance.js';

const newToken = () => randomBytes(32).toString('base64url');

export async function ensureCollaboratorAttendanceLink(db, collaboratorId, { replace = false } = {}) {
  await requireActiveQrCollaborator(db, collaboratorId);
  if (replace) return db.collaboratorAttendanceLink.upsert({
    where: { collaboratorId }, create: { collaboratorId, token: newToken() }, update: { token: newToken() },
  });
  try {
    return await db.collaboratorAttendanceLink.upsert({
      where: { collaboratorId }, create: { collaboratorId, token: newToken() }, update: {},
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    return db.collaboratorAttendanceLink.findUniqueOrThrow({ where: { collaboratorId } });
  }
}

async function identity(db, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) throw qrPageNotFound();
  const link = await db.collaboratorAttendanceLink.findUnique({ where: { token } });
  if (!link) throw qrPageNotFound();
  return requireActiveQrCollaborator(db, link.collaboratorId);
}

function permanentPayload(payload) {
  const rest = { ...payload };
  delete rest.expiresAt;
  delete rest.checkoutOnly;
  return { ...rest, scope: 'collaborator', permanent: true };
}

export async function readCollaboratorAttendanceLink(db, token, { now = new Date() } = {}) {
  const collaborator = await identity(db, token);
  // The address is permanent; service selection and overnight rules stay monthly.
  try {
    return permanentPayload(await readMonthlyPunchQr(db, createMonthlyPunchToken(collaborator.id, now), { now }));
  } catch (error) {
    if (error.code !== 'QR_MONTH_EMPTY') throw error;
    return permanentPayload({ collaboratorName: collaborator.shortName || collaborator.name,
      timeZone: process.env.APP_TIMEZONE || 'Europe/Lisbon', monthFrom: monthlyPunchCycle(now).historyFrom,
      activeDay: null, active: null, services: [] });
  }
}

export async function registerCollaboratorAttendanceLink(db, token, action, request, { now = new Date(), ...options } = {}) {
  const collaborator = await identity(db, token);
  const result = await registerMonthlyPunchQr(db, createMonthlyPunchToken(collaborator.id, now), action, request, {
    ...options, now, allowEmptyAfterCheckout: true,
    authorize: (tx) => identity(tx, token),
  });
  return permanentPayload(result);
}

export async function listCollaboratorAttendanceLinks(db, query = {}, { now = new Date() } = {}) {
  const search = String(query.search || '').trim().slice(0, 150);
  const where = { status: 'active', ...(search ? { OR: [
    { name: { contains: search } }, { shortName: { contains: search } },
  ] } : {}) };
  const cycle = monthlyPunchCycle(now);
  const range = { gte: new Date(`${cycle.historyFrom}T00:00:00Z`), lt: new Date(`${cycle.servicesUntil}T00:00:00Z`) };
  // Filter eligibility before pagination, including cancelled days stored on events.
  const assignments = await db.eventAssignment.findMany({
    where: { collaborator: { is: where }, status: { in: ['confirmed', 'confirmado'] },
      OR: [{ assignmentDate: range }, { assignmentDate: null, event: { date: range } }] },
    select: { collaboratorId: true, assignmentDate: true, status: true,
      event: { select: { date: true, status: true, cancelledDays: true } },
      qrCheckCode: { select: { revokedAt: true } } },
  });
  const counts = new Map();
  for (const assignment of assignments) {
    if (monthlyQrEligible(assignment)) counts.set(assignment.collaboratorId, (counts.get(assignment.collaboratorId) || 0) + 1);
  }
  const total = counts.size;
  const { page, pageSize, skip } = communicationPagination(query, total);
  const items = total ? await db.collaborator.findMany({ where: { ...where, id: { in: [...counts.keys()] } }, skip, take: pageSize,
    orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, shortName: true } }) : [];
  return { ...buildPaginatedPayload({ items: items.map((item) => ({ ...item, confirmedServices: counts.get(item.id) })),
    total, page, pageSize }), monthFrom: cycle.historyFrom };
}
