import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedIntervalLabel, qrSummaryText, qrSummaryDate } from './qrConsultationSummary.js';

test('consultation displays raw clock intervals without changing payment rounding', () => {
  assert.equal(recordedIntervalLabel('08:02', '16:05'), '8:03h');
  assert.equal(recordedIntervalLabel('22:00', '02:00'), '4:00h');
  assert.equal(recordedIntervalLabel('08:00', '08:00'), '0:00h');
  assert.equal(recordedIntervalLabel('', '16:00'), 'Incompleto');
  assert.equal(recordedIntervalLabel('25:00', '16:00'), 'Incompleto');
});

test('monthly copy identifies each service day and excludes future services from the worked-hours summary', () => {
  const payload = { scope: 'month', collaboratorName: 'Ana', historyFrom: '2026-09-01', services: [
    { eventName: 'Morning service', assignmentDate: '2026-09-24', checkIn: '09:00', checkOut: '12:00' },
    { eventName: 'Afternoon service', assignmentDate: '2026-09-24', checkIn: '15:00', checkOut: '18:00' },
    { eventName: 'Future service', assignmentDate: '2026-11-01', upcoming: true },
  ] };
  const text = qrSummaryText(payload);
  assert.match(text, /Desde 01\/09\/2026/);
  assert.equal(text.match(/Dia: 24\/09\/2026/g).length, 2);
  assert.match(text, /Morning service[\s\S]*Afternoon service/);
  assert.doesNotMatch(text, /Future service/);
});

test('copied summary keeps separate shifts and separately identifies validated hours', () => {
  const payload = { scope: 'day', collaboratorName: 'Ana', assignmentDate: '2026-09-24', services: [
    { eventName: 'Manhã', role: 'Emp. Mesa', checkIn: '08:02', checkOut: '13:05', validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '13:00', totalPay: 999, nif: '123456789' },
    { eventName: 'Tarde', checkIn: '16:00', checkOut: '', validationStatus: 'pending' },
  ] };
  const text = qrSummaryText(payload);
  assert.match(text, /Manhã[\s\S]*5:03h[\s\S]*Horário validado: 08:00 → 13:00/);
  assert.match(text, /Tarde[\s\S]*Saída registada: Sem registo[\s\S]*Incompleto/);
  assert.doesNotMatch(text, /999|123456789/);
  assert.equal(qrSummaryDate('2026-11-06T23:59:59.999Z', 'Europe/Lisbon'), '06/11/2026');
  assert.equal(qrSummaryDate('2026-04-01T22:59:59.999Z', 'Europe/Lisbon'), '01/04/2026');
});

test('copied individual, daily and monthly summaries omit validation status without changing records', () => {
  for (const scope of ['individual', 'day', 'month']) {
    for (const validationStatus of ['validated', 'pending', 'reopened', undefined]) {
      const service = { eventName: 'Servico', role: 'Emp. Mesa', assignmentDate: '2026-10-06',
        checkIn: '08:02', checkOut: '16:05', validationStatus, validatedCheckIn: '08:00', validatedCheckOut: '16:00' };
      const payload = { ...service, scope, collaboratorName: 'Ana', historyFrom: '2026-10-01', services: [service] };
      const before = structuredClone(payload);
      const text = qrSummaryText(payload);
      assert.doesNotMatch(text, /Validação:|Por validar|\nValidado(?:\n|$)/);
      assert.match(text, /Entrada registada: 08:02\nSaída registada: 16:05\nIntervalo registado: 8:03h/);
      if (validationStatus === 'validated') assert.match(text, /Horário validado: 08:00 → 16:00/);
      assert.deepEqual(payload, before);
    }
  }
});
