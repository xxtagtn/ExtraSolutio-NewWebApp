import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyQrToken, readDailyQrToken } from './qrDailyToken.js';

const secret = 'test-only-daily-signature-key-not-for-production';

test('daily links are deterministic, shared across services, and isolated by person/day', () => {
  const token = createDailyQrToken(7, '2026-09-24', secret);
  assert.equal(token, createDailyQrToken(7, new Date('2026-09-24T00:00Z'), secret));
  assert.deepEqual(readDailyQrToken(token, secret), { collaboratorId: 7, day: '2026-09-24' });
  assert.notEqual(token, createDailyQrToken(8, '2026-09-24', secret));
  assert.notEqual(token, createDailyQrToken(7, '2026-09-25', secret));
  assert.match(token, /^day1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('daily links reject tampering, bad signatures, malformed payloads and missing keys', () => {
  const token = createDailyQrToken(7, '2026-09-24', secret);
  const [, payload, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify([8, '2026-09-24'])).toString('base64url');
  for (const invalid of ['', 'legacy-token', `${token}.`, `day2.${payload}.${signature}`, `day1.${changed}.${signature}`, `day1.${payload}.x`]) {
    assert.equal(readDailyQrToken(invalid, secret), null);
  }
  assert.equal(readDailyQrToken(token, 'another-key'), null);
  assert.equal(readDailyQrToken(token, ''), null);
  assert.throws(() => createDailyQrToken(7, '2026-09-24', ''), /JWT_SECRET/);
  assert.equal(readDailyQrToken(createDailyQrToken(-1, '2026-09-24', secret), secret), null);
});
