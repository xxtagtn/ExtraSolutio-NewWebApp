import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatServerTime,
  generateQrToken,
  qrCheckOutAvailableAt,
  qrCodeStateForAssignment,
  qrUsageWindow,
  resolveQrPublicBaseUrl,
  validateQrUsage,
} from './qrCheckins.js';

test('checkout protection uses the saved entry and ignores missing entries and old-day logs', () => {
  const input = { event: { date: '2026-09-23' }, timeZone: 'Europe/Lisbon' };
  const oldLog = { recordedAt: '2026-09-22T10:00:45Z' };
  assert.equal(qrCheckOutAvailableAt({ ...input, assignment: { checkIn: null }, checkInLog: oldLog }), null);
  assert.equal(qrCheckOutAvailableAt({ ...input, assignment: { checkIn: '11:00', checkOut: '15:00' } }), null);
  assert.equal(qrCheckOutAvailableAt({ ...input, assignment: { checkIn: '11:00' }, checkInLog: oldLog }).toISOString(), '2026-09-23T10:30:00.000Z');
});

test('checkout protection measures elapsed minutes across Lisbon daylight-saving changes', () => {
  for (const [day, checkIn, recordedAt, expected] of [
    ['2026-03-29', '00:50', '2026-03-29T00:50:30Z', '2026-03-29T01:20:30.000Z'],
    ['2026-10-25', '01:50', '2026-10-25T00:50:30Z', '2026-10-25T01:20:30.000Z'],
    ['2026-10-25', '01:50', '2026-10-25T01:50:30Z', '2026-10-25T02:20:30.000Z'],
  ]) {
    const available = qrCheckOutAvailableAt({ event: { date: day }, assignment: { checkIn }, checkInLog: { recordedAt }, timeZone: 'Europe/Lisbon' });
    assert.equal(available.toISOString(), expected);
  }
});

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
    timeZone: 'Europe/Lisbon',
  });

  assert.equal(window.startsAt.toISOString(), '2026-07-05T23:00:00.000Z');
  assert.equal(window.expiresAt.toISOString(), '2026-07-06T22:59:59.999Z');
});

test('overnight services remain valid after midnight and late entries retain the 30-minute protection', () => {
  const input = { event: { date: '2026-09-24', startTime: '22:00', endTime: '02:00' }, timeZone: 'Europe/Lisbon' };
  assert.equal(qrUsageWindow(input).expiresAt.toISOString(), '2026-09-25T22:59:59.999Z');
  assert.equal(validateQrUsage({ ...input, now: '2026-09-25T01:00:00Z' }), true);
  assert.throws(() => validateQrUsage({ ...input, now: '2026-09-25T23:00:00Z' }), { code: 'QR_EXPIRED' });
  assert.equal(qrCheckOutAvailableAt({ ...input, assignment: { checkIn: '00:15' } }).toISOString(), '2026-09-24T23:45:00.000Z');
  const override = { ...input, assignment: { plannedCheckIn: '11:00', plannedCheckOut: '15:00' } };
  assert.equal(qrUsageWindow(override).expiresAt.toISOString(), '2026-09-24T22:59:59.999Z');
});

test('September 23 QR accepts Lisbon midnight even while the UTC server is on September 22', () => {
  const input = { event: { date: '2026-09-01' }, assignment: { assignmentDate: new Date('2026-09-23T00:00:00Z') }, timeZone: 'Europe/Lisbon' };
  assert.throws(() => validateQrUsage({ ...input, now: '2026-09-22T22:59:59.999Z' }), { code: 'QR_NOT_ACTIVE' });
  assert.equal(validateQrUsage({ ...input, now: '2026-09-22T23:00:00.000Z' }), true);
  assert.equal(validateQrUsage({ ...input, now: '2026-09-23T22:59:59.999Z' }), true);
  assert.throws(() => validateQrUsage({ ...input, now: '2026-09-23T23:00:00.000Z' }), { code: 'QR_EXPIRED' });
});

test('QR windows follow 23-hour and 25-hour Lisbon days and winter time', () => {
  for (const [day, startsAt, expiresAt] of [
    ['2026-03-29', '2026-03-29T00:00:00.000Z', '2026-03-29T22:59:59.999Z'],
    ['2026-10-25', '2026-10-24T23:00:00.000Z', '2026-10-25T23:59:59.999Z'],
    ['2026-12-23', '2026-12-23T00:00:00.000Z', '2026-12-23T23:59:59.999Z'],
  ]) {
    const window = qrUsageWindow({ event: { date: day }, timeZone: 'Europe/Lisbon' });
    assert.equal(window.startsAt.toISOString(), startsAt);
    assert.equal(window.expiresAt.toISOString(), expiresAt);
  }
  assert.throws(() => qrUsageWindow({}), { code: 'QR_INVALID_DATE' });
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
