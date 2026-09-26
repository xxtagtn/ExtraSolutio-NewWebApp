import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { readNotificationOverview } from '../services/notificationOverview.js';
import { readAttendanceAttention } from '../services/attendanceAttention.js';
import { requirePermission } from '../security/permissions.js';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';

export const notificationsRouter = Router();

notificationsRouter.get('/attendance-attention',
  requirePermission(PERMISSIONS.DASHBOARD_VIEW),
  requirePermission(PERMISSIONS.SERVICES_VIEW),
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await readAttendanceAttention(prisma));
  }));

notificationsRouter.get('/overview', asyncHandler(async (req, res) => {
  res.json(await readNotificationOverview(prisma, req.user));
}));

notificationsRouter.get('/ignored', asyncHandler(async (req, res) => {
  const userId = Number(req.user?.id);
  const rows = await prisma.notificationDismissal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { key: true },
  });
  res.json(rows.map((row) => row.key));
}));

notificationsRouter.post('/ignored', asyncHandler(async (req, res) => {
  const userId = Number(req.user?.id);
  const key = String(req.body?.key || '').trim();
  if (!key) return res.status(400).json({ message: 'Chave de notificação inválida.' });

  await prisma.notificationDismissal.upsert({
    where: { userId_key: { userId, key } },
    update: {},
    create: { userId, key },
  });

  res.status(201).json({ ok: true, key });
}));
