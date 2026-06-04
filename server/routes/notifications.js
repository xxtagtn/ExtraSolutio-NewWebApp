import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';

export const notificationsRouter = Router();

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

