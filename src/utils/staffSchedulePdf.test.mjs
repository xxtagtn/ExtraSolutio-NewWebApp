import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStaffScheduleCsv,
  buildStaffScheduleExcelHtml,
  buildStaffSchedulePdfHtml,
  buildStaffScheduleRows,
} from './staffSchedulePdf.js';

test('builds printable staff schedule rows from validation rows', () => {
  const rows = buildStaffScheduleRows([
    {
      event: {
        id: 7,
        name: 'Casa Oeiras',
        client: { name: 'Cliente A' },
        date: '2026-07-08',
        location: 'Lisboa',
        requiredRoles: JSON.stringify([{ role: 'Barman', agreedRate: 12.5 }]),
      },
      assignment: {
        collaborator: { shortName: 'Ana Silva', name: 'Ana Maria Silva' },
        role: 'Barman',
        checkIn: '10:00',
        checkOut: '16:00',
        validationNotes: 'Entrada confirmada',
      },
      staffScheduleHours: 6,
    },
  ]);

  assert.deepEqual(rows[0], {
    eventId: 7,
    eventName: 'Casa Oeiras',
    clientName: 'Cliente A',
    eventDate: '08/07/2026',
    location: 'Lisboa',
    collaboratorName: 'Ana Silva',
    role: 'Barman',
    checkIn: '10:00',
    checkOut: '16:00',
    hours: 6,
    rate: 12.5,
    totalValue: 75,
    notes: 'Entrada confirmada',
  });
});

test('includes total value in staff schedule exports', () => {
  const rows = [{
    event: {
      id: 1,
      name: 'Evento',
      client: { name: 'Cliente' },
      date: '2026-07-08',
      requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 10.5 }]),
    },
    assignment: { collaborator: { shortName: 'Ana' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
    staffScheduleHours: 3,
  }];

  const pdf = buildStaffSchedulePdfHtml(rows, { clientLabel: 'Cliente', monthLabel: 'julho de 2026' });
  const csv = buildStaffScheduleCsv(rows);
  const excel = buildStaffScheduleExcelHtml(rows, { clientLabel: 'Cliente', periodLabel: '08/07/2026' });

  assert.equal(pdf.includes('31,50€'), true);
  assert.equal(csv.includes('31,50€'), true);
  assert.equal(excel.includes('31,50€'), true);
});

test('escapes generated schedule pdf html', () => {
  const html = buildStaffSchedulePdfHtml([
    {
      event: { id: 1, name: '<Evento>', client: { name: 'Cliente' }, date: '2026-07-08' },
      assignment: { collaborator: { shortName: '<Ana>' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
      staffScheduleHours: 3,
    },
  ], { clientLabel: 'Cliente', monthLabel: 'julho de 2026' });

  assert.equal(html.includes('<Ana>'), false);
  assert.equal(html.includes('&lt;Ana&gt;'), true);
  assert.equal(html.includes('3.00 h'), true);
});

test('builds excel compatible csv with escaped values', () => {
  const csv = buildStaffScheduleCsv([
    {
      event: { id: 1, name: 'Evento; Especial', client: { name: 'Cliente' }, date: '2026-07-08' },
      assignment: {
        collaborator: { shortName: 'Ana' },
        role: 'Staff',
        checkIn: '09:00',
        checkOut: '12:00',
        validationNotes: 'Linha 1\nLinha 2',
      },
      staffScheduleHours: 3,
    },
  ]);

  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv.includes('"Evento; Especial"'), true);
  assert.equal(csv.includes('"Linha 1\nLinha 2"'), true);
  assert.equal(csv.includes('3.00'), true);
});

test('builds styled excel html grouped by event with totals', () => {
  const html = buildStaffScheduleExcelHtml([
    {
      event: { id: 1, name: '<Evento>', client: { name: 'Cliente' }, date: '2026-07-08', location: 'Lisboa' },
      assignment: { collaborator: { shortName: '<Ana>' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
      staffScheduleHours: 3,
    },
    {
      event: { id: 1, name: '<Evento>', client: { name: 'Cliente' }, date: '2026-07-08', location: 'Lisboa' },
      assignment: { collaborator: { shortName: 'Rui' }, role: 'Staff', checkIn: '13:00', checkOut: '17:30' },
      staffScheduleHours: 4.5,
    },
  ], { clientLabel: 'Cliente', periodLabel: '08/07/2026' });

  assert.equal(html.includes('<Ana>'), false);
  assert.equal(html.includes('&lt;Ana&gt;'), true);
  assert.equal(html.includes('Total evento'), true);
  assert.equal(html.includes('Total geral'), true);
  assert.equal(html.includes('7.50'), true);
  assert.equal(html.includes('mso-number-format'), true);
});
