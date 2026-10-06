import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyDayInterval, monthlyDaysPage, monthlyServiceDays } from './qrMonthlyPresentation.js';
import { qrSummaryText } from './qrConsultationSummary.js';

const service = { assignmentId: 1, assignmentDate: '2026-10-05', eventName: 'Receção da Embaixada',
  role: 'Emp. Mesa', checkIn: '08:02', checkOut: '16:05' };

test('days are chronological and retain every shift and source record without mutation', () => {
  const rows = [{ ...service, assignmentId: 2, assignmentDate: '2026-10-06' }, service,
    { ...service, assignmentId: 3, checkIn: '17:00', checkOut: '20:00' }];
  const before = structuredClone(rows);
  const days = monthlyServiceDays(rows);
  assert.deepEqual(days.map(([day]) => day), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(days[0][1].map((row) => row.assignmentId), [1, 3]);
  assert.equal(days[0][1][0], service);
  assert.deepEqual(rows, before);
});

test('search matches accents, case, dates and existing service fields but preserves the whole matching day', () => {
  const rows = [service, { ...service, assignmentId: 2, eventName: 'Bar', role: 'Bar' },
    { ...service, assignmentId: 3, assignmentDate: '2026-10-06', eventName: 'Restaurante' }];
  for (const query of ['RECECAO', '  rececao   embaixada ', '05/10/2026', '2026-10-05']) {
    const days = monthlyServiceDays(rows, query);
    assert.equal(days.length, 1);
    assert.equal(days[0][1].length, 2);
  }
  assert.equal(monthlyServiceDays(rows, 'Bar')[0][1].length, 2);
  assert.equal(monthlyServiceDays(rows, 'inexistente').length, 0);
  assert.equal(monthlyServiceDays(rows, '   ').length, 2);
});

test('pagination displays at most five days, including the last partial page', () => {
  const days = monthlyServiceDays(Array.from({ length: 28 }, (_, index) => ({ ...service,
    assignmentDate: `2026-10-${String(index + 1).padStart(2, '0')}` })));
  const first = monthlyDaysPage(days);
  assert.equal(first.items.length, 5);
  assert.deepEqual([first.from, first.to, first.total, first.totalPages], [1, 5, 28, 6]);
  const last = monthlyDaysPage(days, 6);
  assert.equal(last.items.length, 3);
  assert.deepEqual([last.from, last.to], [26, 28]);
  assert.equal(monthlyDaysPage(days, 2).items[0][0], '2026-10-06');
});

test('pagination handles empty results and clamps pages after refreshed data shrinks', () => {
  assert.deepEqual(monthlyDaysPage([], 9), { page: 1, totalPages: 1, items: [], from: 0, to: 0, total: 0 });
  const days = monthlyServiceDays([service]);
  assert.equal(monthlyDaysPage(days, 9).page, 1);
  assert.equal(monthlyDaysPage(days, 0).page, 1);
});

test('daily interval display sums raw consultation intervals, supports overnight shifts and flags incomplete records', () => {
  assert.equal(monthlyDayInterval([service, { ...service, checkIn: '22:00', checkOut: '02:00' }]), '12:03h');
  assert.equal(monthlyDayInterval([{ ...service, checkIn: '08:00', checkOut: '08:00' }]), '0:00h');
  assert.equal(monthlyDayInterval([service, { ...service, checkOut: '' }]), 'Incompleto');
});

test('search and pagination never modify the complete monthly copy summary', () => {
  const payload = { scope: 'month', collaboratorName: 'Ana', historyFrom: '2026-10-01', services: [
    ...Array.from({ length: 20 }, (_, index) => ({ ...service, assignmentId: index + 1,
      assignmentDate: `2026-10-${String(index + 1).padStart(2, '0')}` })),
    { ...service, assignmentId: 30, assignmentDate: '2026-10-31', upcoming: true },
  ] };
  const summary = qrSummaryText(payload);
  monthlyDaysPage(monthlyServiceDays(payload.services, '03/10/2026'), 5);
  assert.equal(qrSummaryText(payload), summary);
  assert.equal((summary.match(/Dia:/g) || []).length, 20);
  assert.doesNotMatch(summary, /Dia: 31\/10\/2026|Validação:/);
});
