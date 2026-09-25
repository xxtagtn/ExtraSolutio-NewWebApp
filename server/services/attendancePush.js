import { randomUUID } from 'node:crypto';
import { setInterval, clearInterval } from 'node:timers';
import { canReceiveAttendancePush } from '../../src/utils/pushPermissions.js';
import { eventDayKey } from '../../src/utils/eventCancelledDays.js';
import { pushConfig, sendDevicePush } from './pushSubscriptions.js';

const DAY = 86400000;
const userInclude = { user: { select: { role: true, permissionOverrides: true, accessProfile: { select: { permissions: true } } } } };
const logInclude = {
  collaborator: { select: { name: true } },
  event: { select: { name: true, date: true } },
  assignment: { select: { assignmentDate: true, plannedCheckIn: true, plannedCheckOut: true } },
};
const wants = (subscription, action) => action === 'check_in' ? subscription.notifyEntry : action === 'check_out' && subscription.notifyExit;

export function attendancePushPayload(log, userId) {
  const day = eventDayKey(log.assignment.assignmentDate || log.event.date);
  const time = new Intl.DateTimeFormat('pt-PT', { timeZone: process.env.APP_TIMEZONE || 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(log.recordedAt);
  const shift = [log.assignment.plannedCheckIn, log.assignment.plannedCheckOut].filter(Boolean).join(' - ');
  return {
    title: log.action === 'check_in' ? 'Entrada registada' : 'Saída registada',
    body: `${log.collaborator.name}\n${log.event.name}${shift ? ` (${shift})` : ''}\n${time}`.slice(0, 800),
    tag: `p-${log.id}`, receiverId: userId,
    url: `/services/${log.eventId}?tab=team&day=${day}&push=1`,
  };
}

// Read only committed QR logs: push failures cannot roll back or delay a punch.
export async function runAttendancePush(db, { now = new Date(), config = pushConfig(), send = sendDevicePush } = {}) {
  if (!config) return { sent: 0, failed: 0 };
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - DAY);
  let cursor = 0;
  for (;;) {
    const subscriptions = await db.pushSubscription.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 100, include: userInclude });
    if (!subscriptions.length) break;
    for (const sub of subscriptions) {
      if (!canReceiveAttendancePush(sub.user)) continue;
      const actions = [sub.notifyEntry && 'check_in', sub.notifyExit && 'check_out'].filter(Boolean);
      if (!actions.length) continue;
      const logs = await db.qrCheckLog.findMany({
        where: { id: { gt: sub.sinceLogId }, recordedAt: { gte: cutoff, lte: now }, action: { in: actions }, pushDeliveries: { none: { subscriptionId: sub.id } } },
        orderBy: { id: 'asc' }, take: 100, select: { id: true },
      });
      for (const log of logs) {
        try { await db.pushDelivery.create({ data: { subscriptionId: sub.id, logId: log.id, nextAttemptAt: now } }); }
        catch (error) { if (!['P2002', 'P2003'].includes(error.code)) throw error; }
      }
    }
    cursor = subscriptions.at(-1).id;
  }
  const readyWhere = { status: 'pending', nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
  const deliveries = await db.pushDelivery.findMany({ where: readyWhere, orderBy: { id: 'asc' }, take: 100, select: { id: true } });
  const result = { sent: 0, failed: 0 };
  for (const item of deliveries) {
    const dispatchAt = new Date(now.getTime() + Date.now() - startedAt);
    const leaseId = randomUUID();
    const claimed = await db.pushDelivery.updateMany({ where: { id: item.id, ...readyWhere }, data: { leaseId, lockedUntil: new Date(dispatchAt.getTime() + 120000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const delivery = await db.pushDelivery.findUnique({ where: { id: item.id }, include: { subscription: { include: userInclude }, log: { include: logInclude } } });
    if (!delivery) continue;
    const { subscription: sub, log } = delivery;
    const finish = (data) => db.pushDelivery.updateMany({ where: { id: delivery.id, leaseId }, data: { ...data, leaseId: null, lockedUntil: null } });
    if (!canReceiveAttendancePush(sub.user) || !wants(sub, log.action) || log.id <= sub.sinceLogId || log.recordedAt < cutoff) {
      await finish({ status: 'skipped' });
      continue;
    }
    try {
      await send(sub, attendancePushPayload(log, sub.userId), config);
      await finish({ status: 'sent', sentAt: dispatchAt, lastError: null });
      result.sent++;
    } catch (error) {
      const code = Number(error.statusCode) || 0;
      if ([404, 410].includes(code)) await db.pushSubscription.deleteMany({ where: { id: sub.id } });
      else await finish({
        status: delivery.attempts >= 5 || (code >= 400 && code < 500 && code !== 429) ? 'failed' : 'pending',
        nextAttemptAt: new Date(dispatchAt.getTime() + Math.min(3600000, 30000 * 2 ** delivery.attempts)),
        lastError: code ? `HTTP_${code}` : 'TRANSPORT_ERROR',
      });
      result.failed++;
    }
  }
  // Only technical delivery metadata is pruned; attendance history stays intact.
  await db.pushDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * DAY) } } });
  return result;
}

export function startAttendancePushScheduler(db) {
  if (!pushConfig()) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAttendancePush(db);
      if (result.sent || result.failed) console.log('[attendance-push]', result);
    } catch (error) {
      // Provider errors may contain private endpoint URLs; never log raw errors.
      console.error('[attendance-push] Não foi possível processar alertas.', error.code === 'P2021' ? 'Executa as migrações da base de dados.' : 'Verifica a configuração e a base de dados.');
    } finally { running = false; }
  };
  const timer = setInterval(tick, 10000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
