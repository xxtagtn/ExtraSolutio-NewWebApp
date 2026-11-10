import { Router } from 'express';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import {
  DOCUMENT_SNOOZE_BATCH_LIMIT, DOCUMENT_SNOOZE_DAYS, DOCUMENT_SNOOZE_PREFIX,
  documentSnoozeKey, parseDocumentSnoozeKey,
} from '../../shared/dashboardDocumentSnooze.js';
import { requirePermission } from '../security/permissions.js';
import { asyncHandler } from '../utils/http.js';

function requestedKeys(value) {
  if (!Array.isArray(value) || !value.length || value.length > DOCUMENT_SNOOZE_BATCH_LIMIT
    || value.some((key) => parseDocumentSnoozeKey(key) === null)) return null;
  return [...new Set(value)].sort();
}

function requestedUntil(body, now) {
  if (DOCUMENT_SNOOZE_DAYS.includes(body?.days) && body.until === undefined) {
    return new Date(now.getTime() + body.days * 86400000);
  }
  if (body?.days !== undefined || typeof body?.until !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.until)) return null;
  const until = new Date(body.until);
  return until > now && until.toISOString() === body.until ? until : null;
}

export function createDashboardDocumentSnoozeRouter(db, { clock = () => new Date() } = {}) {
  const router = Router();
  router.use(requirePermission(PERMISSIONS.DASHBOARD_VIEW), requirePermission(PERMISSIONS.COLLABORATORS_VIEW));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await db.notificationDismissal.findMany({
      where: { userId: req.user.id, key: { startsWith: DOCUMENT_SNOOZE_PREFIX }, snoozedUntil: { gt: clock() } },
      select: { key: true, snoozedUntil: true },
    }));
  }));

  router.put('/', asyncHandler(async (req, res) => {
    const keys = requestedKeys(req.body?.keys);
    const now = clock();
    const snoozedUntil = requestedUntil(req.body, now);
    if (!keys || !snoozedUntil) return res.status(400).json({ message: 'Seleciona alertas de documentos e uma data futura.' });
    const userId = req.user.id;
    const collaborators = await db.collaborator.findMany({
      where: { id: { in: keys.map(parseDocumentSnoozeKey) }, status: { not: 'inactive' } },
      select: { id: true, documentExpiry: true },
    });
    const validKeys = new Set(collaborators.map((row) => documentSnoozeKey(row.id, row.documentExpiry)));
    if (keys.some((key) => !validKeys.has(key))) {
      return res.status(409).json({ message: 'Um dos documentos foi alterado. Atualiza o Dashboard e tenta novamente.' });
    }

    await db.$transaction([
      db.notificationDismissal.deleteMany({ where: { userId, key: { startsWith: DOCUMENT_SNOOZE_PREFIX }, snoozedUntil: { lte: now } } }),
      ...keys.map((key) => db.notificationDismissal.upsert({
        where: { userId_key: { userId, key } }, update: { snoozedUntil }, create: { userId, key, snoozedUntil },
      })),
    ]);
    res.json({ snoozedUntil });
  }));

  router.delete('/', asyncHandler(async (req, res) => {
    const keys = requestedKeys(req.body?.keys);
    if (!keys) return res.status(400).json({ message: 'Seleciona alertas de documentos válidos.' });
    await db.notificationDismissal.deleteMany({
      where: { userId: req.user.id, key: { in: keys }, snoozedUntil: { not: null } },
    });
    res.json({ ok: true });
  }));
  router.use((error, _req, res, next) => {
    if (!['P2021', 'P2022'].includes(error?.code)) return next(error);
    return res.status(503).json({ message: 'Aplica a migração da base de dados dos adiamentos.' });
  });
  return router;
}
