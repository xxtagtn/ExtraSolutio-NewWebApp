import { createHash, createECDH, ECDH } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import webPush from 'web-push';

export const pushError = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose: true });
export const endpointHash = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

export function pushConfig(env = process.env) {
  const vapidDetails = { subject: env.WEB_PUSH_SUBJECT, publicKey: env.WEB_PUSH_PUBLIC_KEY, privateKey: env.WEB_PUSH_PRIVATE_KEY };
  try {
    if (!vapidDetails.subject || !vapidDetails.publicKey || !vapidDetails.privateKey) return null;
    const keyPair = createECDH('prime256v1');
    keyPair.setPrivateKey(Buffer.from(vapidDetails.privateKey, 'base64url'));
    if (keyPair.getPublicKey().toString('base64url') !== vapidDetails.publicKey) return null;
    webPush.getVapidHeaders('https://fcm.googleapis.com', vapidDetails.subject, vapidDetails.publicKey, vapidDetails.privateKey, 'aes128gcm');
    return { vapidDetails };
  } catch { return null; }
}

export function validatePushSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { throw pushError(400, 'Subscrição push inválida.'); }
  const host = url.hostname;
  const trusted = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (!trusted || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 2048) {
    throw pushError(400, 'Servidor de notificações não suportado.');
  }
  const { p256dh, auth } = value?.keys || {};
  for (const [key, size] of [[p256dh, 65], [auth, 16]]) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key) || Buffer.from(key, 'base64url').length !== size) throw pushError(400, 'Chaves push inválidas.');
  }
  try { ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1'); } catch { throw pushError(400, 'Chave push inválida.'); }
  return { endpoint: url.href, endpointHash: endpointHash(url.href), p256dh, auth };
}

export function pushDevicePayload(row) {
  return row ? { id: row.id, notifyEntry: row.notifyEntry, notifyExit: row.notifyExit } : null;
}

export async function savePushSubscription(db, userId, body) {
  const data = validatePushSubscription(body?.subscription);
  if (typeof body.notifyEntry !== 'boolean' || typeof body.notifyExit !== 'boolean') throw pushError(400, 'Preferências inválidas.');
  return db.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({ where: { endpointHash: data.endpointHash } });
    if (existing && existing.userId !== userId) throw pushError(409, 'Este dispositivo está associado a outra conta. Desativa as notificações antes de o associar.');
    const changed = !existing || existing.notifyEntry !== body.notifyEntry || existing.notifyExit !== body.notifyExit;
    const latest = changed ? await tx.qrCheckLog.aggregate({ _max: { id: true } }) : null;
    const preferences = { notifyEntry: body.notifyEntry, notifyExit: body.notifyExit, ...(changed ? { sinceLogId: latest?._max.id || 0 } : {}) };
    // A concurrent registration must never transfer another user's endpoint.
    if (!existing) return tx.pushSubscription.create({ data: { ...data, userId, ...preferences } });
    return tx.pushSubscription.update({ where: { id: existing.id, userId }, data: { ...data, ...preferences } });
  });
}

export function sendDevicePush(subscription, payload, config) {
  // Never follow arbitrary client URLs or expose subscription keys in logs.
  validatePushSubscription({ endpoint: subscription.endpoint, keys: subscription });
  return webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), {
    ...config, timeout: 5000, TTL: 3600, urgency: 'normal', topic: payload.tag,
  });
}
