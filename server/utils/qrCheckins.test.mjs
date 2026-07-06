import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatServerTime,
  generateQrToken,
  qrCodeStateForAssignment,
  qrUsageWindow,
  resolveQrPublicBaseUrl,
  validateQrUsage,
} from './qrCheckins.js';

test('generateQrToken creates an opaque URL-safe token', () => {
  const bytes = Buffer.from('01234567890123456789012345678901');
  const token = generateQrToken(() => bytes);

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(token, bytes.toString('base64url'));
  assert.equal(token.includes('='), false);
});

test('qrCodeStateForAssignment follows the check-in lifecycle', () => {
  assert.deepEqual(qrCodeStateForAssignment({}), {
    key: 'qr_generated',
    label: 'QR Gerado',
    nextAction: 'check_in',
  });

  assert.deepEqual(qrCodeStateForAssignment({ checkIn: '10:00' }), {
    key: 'entrada_registada',
    label: 'Entrada Registada',
    nextAction: 'check_out',
  });

  assert.deepEqual(qrCodeStateForAssignment({ checkIn: '10:00', checkOut: '18:00' }), {
    key: 'servico_concluido',
    label: 'Serviço Concluído',
    nextAction: null,
  });
});

test('qrUsageWindow uses the assignment day and expires at the end of that day', () => {
  const window = qrUsageWindow({
    event: { date: '2026-07-05T00:00:00.000Z', endDate: '2026-07-08T00:00:00.000Z' },
    assignment: { assignmentDate: '2026-07-06T00:00:00.000Z' },
  });

  assert.equal(window.startsAt.toISOString(), '2026-07-06T00:00:00.000Z');
  assert.equal(window.expiresAt.toISOString(), '2026-07-06T23:59:59.999Z');
});

test('validateQrUsage rejects an expired QR code', () => {
  assert.throws(
    () => validateQrUsage({
      event: { date: '2026-07-05T00:00:00.000Z' },
      assignment: { assignmentDate: '2026-07-05T00:00:00.000Z' },
      now: new Date('2026-07-06T00:00:00.000Z'),
    }),
    /expirado/i,
  );
});

test('formatServerTime returns HH:MM in Portuguese server timezone', () => {
  assert.equal(formatServerTime(new Date('2026-07-05T13:04:00.000Z'), 'UTC'), '13:04');
});

test('resolveQrPublicBaseUrl keeps an explicit public URL', () => {
  assert.equal(
    resolveQrPublicBaseUrl({
      configured: 'http://extrasolutio.local:5173/',
      origin: 'http://localhost:5173',
      protocol: 'http',
      host: 'localhost:3001',
    }),
    'http://extrasolutio.local:5173',
  );
});

test('resolveQrPublicBaseUrl keeps a non-local browser origin', () => {
  assert.equal(
    resolveQrPublicBaseUrl({
      origin: 'http://192.168.1.65:5173',
      protocol: 'http',
      host: '192.168.1.65:3001',
    }),
    'http://192.168.1.65:5173',
  );
});

test('resolveQrPublicBaseUrl replaces localhost with a LAN address for mobile QR scans', () => {
  const interfaces = {
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.1.65' },
    ],
  };

  assert.equal(
    resolveQrPublicBaseUrl({
      origin: 'http://localhost:5173',
      protocol: 'http',
      host: 'localhost:3001',
    }, interfaces),
    'http://192.168.1.65:5173',
  );
});
