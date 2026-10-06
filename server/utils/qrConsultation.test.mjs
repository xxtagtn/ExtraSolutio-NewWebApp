import test from 'node:test';
import assert from 'node:assert/strict';
import { qrConsultationAccess, publicQrValidation, QR_CONSULTATION_DAYS } from './qrConsultation.js';
import { qrUsageWindow, validateQrUsage } from './qrCheckins.js';

test('31 calendar days of consultation do not extend the punch window', () => {
  const input = { event: { date: '2026-10-06', startTime: '08:00', endTime: '16:00' }, timeZone: 'Europe/Lisbon' };
  const window = qrUsageWindow(input);
  const access = qrConsultationAccess({ ...input, now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(QR_CONSULTATION_DAYS, 31);
  assert.deepEqual(access.punchExpiresAt, window.expiresAt);
  assert.equal(access.consultationExpiresAt.toISOString(), '2026-11-06T23:59:59.999Z');
  assert.equal(access.readOnly, true);
  assert.throws(() => validateQrUsage({ ...input, now: new Date('2026-10-10T12:00:00Z') }), { code: 'QR_EXPIRED' });
  assert.equal(qrConsultationAccess({ ...input, now: window.expiresAt }).readOnly, false);
  assert.equal(qrConsultationAccess({ ...input, now: new Date(window.expiresAt.getTime() + 1) }).readOnly, true);
});

test('consultation uses assignment day, handles overnight services, month/year rollover and DST', () => {
  for (const [day, endTime, expected] of [
    ['2026-03-01', '16:00', '2026-04-01T22:59:59.999Z'],
    ['2026-09-24', '16:00', '2026-10-25T23:59:59.999Z'],
    ['2026-12-15', '16:00', '2027-01-15T23:59:59.999Z'],
    ['2026-09-24', '02:00', '2026-10-26T23:59:59.999Z'],
  ]) {
    const result = qrConsultationAccess({ event: { date: '2026-01-01', isContinuous: true, endDate: '2026-12-31' },
      assignment: { assignmentDate: day, plannedCheckIn: endTime === '02:00' ? '22:00' : '08:00', plannedCheckOut: endTime }, timeZone: 'Europe/Lisbon' });
    assert.equal(result.consultationExpiresAt.toISOString(), expected);
  }
  assert.throws(() => qrConsultationAccess({}), { code: 'QR_INVALID_DATE' });
});

test('public validation exposes only confirmed schedule fields, never payment or personal data', () => {
  const assignment = { validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '16:00', checkIn: '08:02', checkOut: '16:05', totalPay: 100, paymentStatus: 'paid', collaborator: { nif: '123456789' } };
  assert.deepEqual(publicQrValidation(assignment), { validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '16:00' });
  assert.deepEqual(publicQrValidation({ ...assignment, validationStatus: 'matched' }), { validationStatus: 'pending', validatedCheckIn: '', validatedCheckOut: '' });
  assert.deepEqual(publicQrValidation({ validationStatus: 'approved', clientCheckIn: '09:00', clientCheckOut: '17:00' }), { validationStatus: 'validated', validatedCheckIn: '09:00', validatedCheckOut: '17:00' });
});
