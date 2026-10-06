import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { applicationDay, createMonthlyQrToken, monthlyQrCycle, readMonthlyQrToken } from './qrMonthlyToken.js';

const secret = 'isolated-monthly-qr-test';
test('monthly link rotates on the 1st and remains read-only through the following 14th', () => {
  const first = new Date('2026-10-01T00:00:00+01:00');
  const last = new Date('2026-10-31T23:59:59.999Z');
  const next = new Date('2026-11-01T00:00:00Z');
  const token = createMonthlyQrToken(1, first, secret);
  assert.equal(createMonthlyQrToken(1, last, secret), token);
  assert.equal(readMonthlyQrToken(token, { now: last, secret }).expired, false);
  assert.equal(readMonthlyQrToken(token, { now: last, secret }).consultationOnly, false);
  assert.equal(readMonthlyQrToken(token, { now: next, secret }).expired, false);
  assert.equal(readMonthlyQrToken(token, { now: next, secret }).consultationOnly, true);
  assert.equal(readMonthlyQrToken(token, { now: new Date('2026-11-14T23:59:59.999Z'), secret }).expired, false);
  assert.equal(readMonthlyQrToken(token, { now: new Date('2026-11-15T00:00:00Z'), secret }).expired, true);
  assert.notEqual(createMonthlyQrToken(1, next, secret), token);
  assert.notEqual(createMonthlyQrToken(2, first, secret), token);
  assert.equal(readMonthlyQrToken(token.replace('month1.', 'day1.'), { now: first, secret }), null);
  assert.equal(readMonthlyQrToken(`${token}x`, { now: first, secret }), null);
  assert.equal(readMonthlyQrToken(token, { now: first, secret: 'wrong-key' }), null);
  assert.equal(readMonthlyQrToken(createMonthlyQrToken(1, next, secret), { now: first, secret }).expired, true);
});

test('calendar cycles and history cutoff handle year rollover and Lisbon DST independently of host timezone', () => {
  for (const [now, key, expiry, punchExpiry, historyFrom] of [
    ['2026-01-06T12:00:00Z', '2026-01-01', '2026-02-14T23:59:59.999Z', '2026-01-31T23:59:59.999Z', '2025-12-01'],
    ['2026-03-16T00:00:00Z', '2026-03-01', '2026-04-14T22:59:59.999Z', '2026-03-31T22:59:59.999Z', '2026-03-01'],
    ['2026-10-16T00:00:00+01:00', '2026-10-01', '2026-11-14T23:59:59.999Z', '2026-10-31T23:59:59.999Z', '2026-10-01'],
    ['2028-02-15T12:00:00Z', '2028-02-01', '2028-03-14T23:59:59.999Z', '2028-02-29T23:59:59.999Z', '2028-02-01'],
    ['2026-12-20T12:00:00Z', '2026-12-01', '2027-01-14T23:59:59.999Z', '2026-12-31T23:59:59.999Z', '2026-12-01'],
  ]) {
    const cycle = monthlyQrCycle(new Date(now), 'Europe/Lisbon');
    assert.equal(cycle.key, key);
    assert.equal(cycle.expiresAt.toISOString(), expiry);
    assert.equal(cycle.punchExpiresAt.toISOString(), punchExpiry);
    assert.equal(cycle.historyFrom, historyFrom);
  }
  assert.equal(applicationDay(new Date('2026-10-15T23:00:00Z'), 'Europe/Lisbon'), '2026-10-16');
});

test('already-issued 16th-to-15th links retain their original expiry', () => {
  const encoded = Buffer.from(JSON.stringify([1, '2026-09-16'])).toString('base64url');
  const signature = createHmac('sha256', secret).update(`extrasolutio:qr-month:v1:${encoded}`).digest('base64url');
  const token = `month1.${encoded}.${signature}`;
  const valid = readMonthlyQrToken(token, { now: new Date('2026-10-15T23:59:59.999+01:00'), secret });
  assert.equal(valid.expired, false);
  assert.equal(valid.cycle.legacy, true);
  assert.equal(readMonthlyQrToken(token, { now: new Date('2026-10-16T00:00:00+01:00'), secret }).expired, true);
});
