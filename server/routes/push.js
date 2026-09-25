import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { canReceiveAttendancePush } from '../../src/utils/pushPermissions.js';
import { asyncHandler } from '../utils/http.js';
import { endpointHash, pushConfig, pushDevicePayload, pushError, savePushSubscription, sendDevicePush } from '../services/pushSubscriptions.js';

export function createPushRouter(db, { getConfig = pushConfig, send = sendDevicePush } = {}) {
  const router = Router();
  router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Autenticação necessária.' });
    if (!canReceiveAttendancePush(req.user)) return res.status(403).json({ message: 'Sem permissão para notificações de picagens.' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/config', (_req, res) => {
    const config = getConfig();
    res.json({ configured: Boolean(config), publicKey: config?.vapidDetails.publicKey || null });
  });
  const device = (req) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 2048) throw pushError(400, 'Dispositivo inválido.');
    return { userId: req.user.id, endpointHash: endpointHash(endpoint) };
  };
  router.post('/device', asyncHandler(async (req, res) => {
    res.json(pushDevicePayload(await db.pushSubscription.findFirst({ where: device(req) })));
  }));
  router.put('/device', asyncHandler(async (req, res) => {
    if (!getConfig()) throw pushError(503, 'Notificações não configuradas no servidor.');
    try { res.json(pushDevicePayload(await savePushSubscription(db, req.user.id, req.body))); }
    catch (error) {
      if (error.code === 'P2002') throw pushError(409, 'Este dispositivo já está associado. Atualiza o perfil e tenta novamente.');
      throw error;
    }
  }));
  router.delete('/device', asyncHandler(async (req, res) => {
    await db.pushSubscription.deleteMany({ where: device(req) });
    res.json({ ok: true });
  }));
  router.post('/test', asyncHandler(async (req, res) => {
    const config = getConfig();
    if (!config) throw pushError(503, 'Notificações não configuradas no servidor.');
    const sub = await db.pushSubscription.findFirst({ where: device(req) });
    if (!sub) throw pushError(404, 'Ativa as notificações neste dispositivo.');
    const now = new Date();
    const updated = await db.pushSubscription.updateMany({ where: { id: sub.id, OR: [{ lastTestAt: null }, { lastTestAt: { lt: new Date(now.getTime() - 60000) } }] }, data: { lastTestAt: now } });
    if (!updated.count) throw pushError(429, 'Aguarda um minuto antes de repetir o teste.');
    try {
      await send(sub, { title: 'ExtraSolutio', body: 'Notificações de picagens ativas neste dispositivo.', tag: `t-${randomUUID().slice(0, 20)}`, receiverId: req.user.id, url: '/profile' }, config);
    } catch (error) {
      if ([404, 410].includes(Number(error.statusCode))) await db.pushSubscription.deleteMany({ where: { id: sub.id } });
      throw pushError(502, 'Não foi possível enviar o teste. Verifica a configuração ou volta a ativar este dispositivo.');
    }
    res.json({ message: 'Teste enviado ao serviço de notificações. Confirma a receção no dispositivo.' });
  }));
  router.use((error, _req, res, _next) => {
    if (error.expose) return res.status(error.statusCode || 500).json({ message: error.message });
    // Prisma/transport errors can contain subscription endpoints and keys.
    console.error('[attendance-push] Pedido de dispositivo falhou.', /^P\d{4}$/.test(error.code || '') ? error.code : 'INTERNAL_ERROR');
    return res.status(500).json({ message: 'Não foi possível atualizar as notificações. Verifica a configuração e as migrações do servidor.' });
  });
  return router;
}
