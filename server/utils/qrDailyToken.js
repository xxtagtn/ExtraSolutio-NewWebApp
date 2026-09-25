import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { eventDayKey } from '../../src/utils/eventCancelledDays.js';

function signature(payload, secret) {
  if (!secret) throw new Error('JWT_SECRET em falta para assinar o link diário.');
  return crypto.createHmac('sha256', secret).update(`extrasolutio:qr-day:v1:${payload}`).digest();
}

export function createDailyQrToken(collaboratorId, date, secret = process.env.JWT_SECRET) {
  const day = eventDayKey(date);
  const payload = Buffer.from(JSON.stringify([Number(collaboratorId), day])).toString('base64url');
  return `day1.${payload}.${signature(payload, secret).toString('base64url')}`;
}

export function readDailyQrToken(token, secret = process.env.JWT_SECRET) {
  try {
    const parts = String(token || '').split('.');
    const [version, payload, signed] = parts;
    if (parts.length !== 3 || version !== 'day1' || !payload || !signed) return null;
    const expected = signature(payload, secret);
    const actual = Buffer.from(signed, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const [collaboratorId, day] = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!Number.isSafeInteger(collaboratorId) || collaboratorId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
    return { collaboratorId, day };
  } catch {
    return null;
  }
}
