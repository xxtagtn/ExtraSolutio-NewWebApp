import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { eventStartInstant } from './eventTime.js';

export function applicationDay(now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function monthlyQrCycle(now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  const day = applicationDay(now, timeZone);
  const [year, month] = day.split('-').map(Number);
  return calendarCycle(monthDay(year, month, 1), now, timeZone);
}

function calendarCycle(startDay, now, timeZone) {
  const day = applicationDay(now, timeZone);
  const [year, month] = startDay.split('-').map(Number);
  const servicesUntil = monthDay(year, month + 1, 1);
  const consultationUntil = monthDay(year, month + 1, 15);
  return {
    key: startDay, timeZone, day,
    startsAt: eventStartInstant(startDay, '00:00', timeZone),
    punchExpiresAt: new Date(eventStartInstant(servicesUntil, '00:00', timeZone).getTime() - 1),
    expiresAt: new Date(eventStartInstant(consultationUntil, '00:00', timeZone).getTime() - 1),
    servicesUntil,
    historyFrom: startDay,
  };
}

function legacyCycle(startDay, now, timeZone) {
  const [year, month] = startDay.split('-').map(Number);
  const servicesUntil = monthDay(year, month + 1, 1);
  const expiresAt = new Date(eventStartInstant(monthDay(year, month + 1, 16), '00:00', timeZone).getTime() - 1);
  return {
    key: startDay, timeZone, day: applicationDay(now, timeZone), legacy: true,
    startsAt: eventStartInstant(startDay, '00:00', timeZone), expiresAt,
    punchExpiresAt: new Date(eventStartInstant(servicesUntil, '00:00', timeZone).getTime() - 1),
    historyFrom: monthDay(year, month, 1), servicesUntil,
  };
}

function signature(encoded, secret) {
  if (!secret) throw new Error('JWT_SECRET em falta para assinar o link mensal.');
  return createHmac('sha256', secret).update(`extrasolutio:qr-month:v1:${encoded}`).digest();
}

export function createMonthlyQrToken(collaboratorId, now = new Date(), secret = process.env.JWT_SECRET) {
  if (!Number.isSafeInteger(Number(collaboratorId)) || Number(collaboratorId) <= 0) throw new Error('Colaborador inválido.');
  const encoded = Buffer.from(JSON.stringify([Number(collaboratorId), monthlyQrCycle(now).key])).toString('base64url');
  return `month1.${encoded}.${signature(encoded, secret).toString('base64url')}`;
}

export function readMonthlyQrToken(token, { now = new Date(), secret = process.env.JWT_SECRET } = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'month1') return null;
    const actual = Buffer.from(parts[2], 'base64url');
    const expected = signature(parts[1], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const identity = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!Array.isArray(identity) || identity.length !== 2 || !Number.isSafeInteger(identity[0]) || identity[0] <= 0) return null;
    const key = identity[1];
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-(01|16)$/.test(key)) return null;
    const [year, month, date] = key.split('-').map(Number);
    if (monthDay(year, month, date) !== key) return null;
    const timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon';
    // Keep already-issued 16th-to-15th links usable until their original expiry.
    const cycle = date === 16 ? legacyCycle(key, now, timeZone) : calendarCycle(key, now, timeZone);
    return { collaboratorId: identity[0], cycle, expired: now < cycle.startsAt || now > cycle.expiresAt,
      consultationOnly: now > cycle.punchExpiresAt };
  } catch {
    return null;
  }
}

export function monthlyPunchCycle(now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  const cycle = monthlyQrCycle(now, timeZone);
  return { ...cycle, expiresAt: cycle.punchExpiresAt };
}

function punchSignature(encoded, secret) {
  if (!secret) throw new Error('JWT_SECRET em falta para assinar o link mensal.');
  return createHmac('sha256', secret).update(`extrasolutio:qr-month:v2:${encoded}`).digest();
}

export function createMonthlyPunchToken(collaboratorId, now = new Date(), secret = process.env.JWT_SECRET) {
  if (!Number.isSafeInteger(Number(collaboratorId)) || Number(collaboratorId) <= 0) throw new Error('Colaborador inválido.');
  const encoded = Buffer.from(JSON.stringify([Number(collaboratorId), monthlyPunchCycle(now).key])).toString('base64url');
  return `month2.${encoded}.${punchSignature(encoded, secret).toString('base64url')}`;
}

export function readMonthlyPunchToken(token, { now = new Date(), secret = process.env.JWT_SECRET } = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'month2') return null;
    const actual = Buffer.from(parts[2], 'base64url');
    const expected = punchSignature(parts[1], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const values = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!Array.isArray(values) || values.length !== 2 || !Number.isSafeInteger(values[0]) || values[0] <= 0) return null;
    const key = values[1];
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-01$/.test(key)) return null;
    const [year, month] = key.split('-').map(Number);
    if (monthDay(year, month, 1) !== key) return null;
    const timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon';
    const cycle = calendarCycle(key, now, timeZone);
    cycle.expiresAt = cycle.punchExpiresAt;
    return { collaboratorId: values[0], cycle, notActive: now < cycle.startsAt, expired: now > cycle.expiresAt };
  } catch {
    return null;
  }
}
