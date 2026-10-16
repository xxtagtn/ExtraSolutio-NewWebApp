import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export function verifyWhatsAppSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string'
    || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function captureWhatsAppBody(req, _res, buffer) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (req.method === 'POST' && /^\/api\/whatsapp\/webhook\/?$/.test(path)) {
    req.whatsappRawBody = buffer;
  }
}

export function requireWhatsAppSignature(req, res, next) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return res.status(503).json({ message: 'Webhook WhatsApp indisponivel.' });
  if (!verifyWhatsAppSignature(req.whatsappRawBody, req.headers['x-hub-signature-256'], secret)) {
    return res.status(401).json({ message: 'Assinatura WhatsApp invalida.' });
  }
  return next();
}
