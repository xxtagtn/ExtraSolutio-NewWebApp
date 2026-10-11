import test from 'node:test';
import assert from 'node:assert/strict';
import { publicQrCheckoutReceipt } from './qrAttendance.js';

test('checkout confirmation exposes only the committed service and raw punch times, not finance, validation or token data', () => {
  const qr = {
    token: 'private-token', collaborator: { name: 'Full name', shortName: 'Ana', nif: 'private' },
    event: { name: 'Evento concluido', date: new Date('2026-10-01'), client: { name: 'Cliente' },
      location: 'Lisboa', startTime: '18:00', endTime: '04:00' },
    assignment: { id: 42, assignmentDate: new Date('2026-10-11'), role: 'Bar', checkIn: '17:34', checkOut: '04:07',
      plannedCheckIn: '18:30', plannedCheckOut: '04:30', clientCheckIn: '19:00', clientCheckOut: '03:00',
      validatedCheckIn: '20:00', validatedCheckOut: '02:00', validationStatus: 'approved',
      totalPay: 100, hourlyRate: 10 },
  };
  const before = structuredClone(qr);
  assert.deepEqual(publicQrCheckoutReceipt(qr), {
    assignmentId: 42, collaboratorName: 'Ana', eventName: 'Evento concluido', clientName: 'Cliente',
    assignmentDate: '2026-10-11', role: 'Bar', location: 'Lisboa',
    plannedCheckIn: '18:30', plannedCheckOut: '04:30', checkIn: '17:34', checkOut: '04:07',
  });
  assert.deepEqual(qr, before, 'Creating the confirmation must not modify any data');
});

test('checkout confirmation requires both saved punches', () => {
  for (const qr of [undefined, {}, { assignment: { checkIn: '18:00' } }, { assignment: { checkOut: '04:00' } }]) {
    assert.equal(publicQrCheckoutReceipt(qr), null);
  }
});

test('checkout confirmation uses event schedule and service date fallbacks', () => {
  const receipt = publicQrCheckoutReceipt({ assignment: { id: 1, checkIn: '18:01', checkOut: '04:02',
    collaborator: { name: 'Ana' }, event: { name: 'Evento', date: new Date('2026-12-31'),
      startTime: '18:00', endTime: '04:00' } } });
  assert.equal(receipt.assignmentDate, '2026-12-31');
  assert.equal(receipt.collaboratorName, 'Ana');
  assert.equal(receipt.plannedCheckIn, '18:00');
  assert.equal(receipt.plannedCheckOut, '04:00');
});
