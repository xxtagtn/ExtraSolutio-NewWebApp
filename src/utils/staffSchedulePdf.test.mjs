import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStaffScheduleCsv,
  buildStaffScheduleExcelHtml,
  buildStaffSchedulePdfHtml,
  buildStaffScheduleRows,
  createStaffScheduleWorkbook,
} from './staffSchedulePdf.js';

const importedXlsx = await import('xlsx-js-style');
const XLSX = importedXlsx.default || importedXlsx;

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
        collaborator: { shortName: 'Ana Silva', name: 'Ana Maria Silva', nif: '123456789' },
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
    collaboratorNif: '123456789',
    role: 'Barman',
    workLocationsEnabled: false,
    workLocationName: '',
    checkIn: '10:00',
    checkOut: '16:00',
    hours: 6,
    rate: 12.5,
    totalValue: 75,
    notes: 'Entrada confirmada',
  });
});

test('creates one worksheet per event with per-event totals at the top', () => {
  const rows = [
    {
      event: {
        id: 10,
        name: 'Evento Contínuo / Julho',
        client: { name: 'Cliente A' },
        location: 'Lisboa',
        requiredRoles: JSON.stringify([{ role: 'Emp. Mesa', agreedRate: 10 }]),
      },
      assignment: {
        collaborator: { shortName: 'Ana', nif: '123456789' },
        role: 'Emp. Mesa',
        checkIn: '10:00',
        checkOut: '13:00',
      },
      workDateKey: '2026-07-08',
      staffScheduleHours: 3,
    },
    {
      event: {
        id: 10,
        name: 'Evento Contínuo / Julho',
        client: { name: 'Cliente A' },
        location: 'Lisboa',
        requiredRoles: JSON.stringify([{ role: 'Emp. Mesa', agreedRate: 10 }]),
      },
      assignment: {
        collaborator: { shortName: 'Bruno', nif: '987654321' },
        role: 'Emp. Mesa',
        checkIn: '14:00',
        checkOut: '16:00',
      },
      workDateKey: '2026-07-09',
      staffScheduleHours: 2,
    },
    {
      event: {
        id: 11,
        name: 'Outro Evento / Junho',
        client: { name: 'Cliente B' },
        location: 'Porto',
        requiredRoles: JSON.stringify([{ role: 'Bar', agreedRate: 12.5 }]),
      },
      assignment: {
        collaborator: { shortName: 'Carla', nif: '111222333' },
        role: 'Bar',
        checkIn: '12:00',
        checkOut: '16:00',
      },
      workDateKey: '2026-06-15',
      staffScheduleHours: 4,
    },
  ];

  const workbook = createStaffScheduleWorkbook(rows, { XLSX });
  assert.equal(workbook.SheetNames.length, 2);
  assert.equal(workbook.SheetNames.every((name) => name.length <= 31), true);

  const continuousSheet = workbook.Sheets[workbook.SheetNames.find((name) => name.startsWith('Evento Cont'))];
  const values = XLSX.utils.sheet_to_json(continuousSheet, { header: 1, defval: '' }).flat().join('|');
  assert.equal(values.includes('Total de horas Staff'), true);
  assert.equal(values.includes('5:00h'), true);
  assert.equal(values.includes('Valor total dos serviços'), true);
  assert.equal(values.includes('50,00\u00a0€'), true);
  assert.equal(values.includes('08/07/2026'), true);
  assert.equal(values.includes('09/07/2026'), true);
});

test('uses assignment date as printable schedule date when present', () => {
  const rows = buildStaffScheduleRows([
    {
      event: {
        id: 7,
        name: 'Evento Continuo',
        client: { name: 'Cliente A' },
        date: '2026-07-01',
        location: 'Lisboa',
      },
      assignment: {
        assignmentDate: '2026-07-04',
        collaborator: { shortName: 'Ana Silva' },
        role: 'Staff',
        checkIn: '10:00',
        checkOut: '16:00',
      },
      staffScheduleHours: 6,
    },
  ]);

  assert.equal(rows[0].eventDate, '04/07/2026');
});

test('groups printable schedules by event date for continuous services', () => {
  const html = buildStaffSchedulePdfHtml([
    {
      event: { id: 7, name: 'Evento Continuo', client: { name: 'Cliente A' }, date: '2026-07-01' },
      assignment: { assignmentDate: '2026-07-04', collaborator: { shortName: 'Ana' }, role: 'Staff', checkIn: '10:00', checkOut: '16:00' },
      staffScheduleHours: 6,
    },
    {
      event: { id: 7, name: 'Evento Continuo', client: { name: 'Cliente A' }, date: '2026-07-01' },
      assignment: { assignmentDate: '2026-07-05', collaborator: { shortName: 'Rui' }, role: 'Staff', checkIn: '10:00', checkOut: '16:00' },
      staffScheduleHours: 6,
    },
  ], { clientLabel: 'Cliente A', monthLabel: 'julho de 2026' });

  assert.equal((html.match(/Evento Continuo/g) || []).length, 2);
  assert.equal(html.includes('04/07/2026'), true);
  assert.equal(html.includes('05/07/2026'), true);
});

test('shows event total without collaborator rates or totals in pdf and excel exports', () => {
  const rows = [
    {
      event: {
        id: 1,
        name: 'Evento',
        client: { name: 'Cliente' },
        date: '2026-07-08',
        requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 12.5 }]),
      },
      assignment: { collaborator: { shortName: 'Ana' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
      staffScheduleHours: 3,
    },
    {
      event: {
        id: 1,
        name: 'Evento',
        client: { name: 'Cliente' },
        date: '2026-07-08',
        requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 12.5 }]),
      },
      assignment: { collaborator: { shortName: 'Rui' }, role: 'Staff', checkIn: '13:00', checkOut: '15:00' },
      staffScheduleHours: 2,
    },
  ];

  const pdf = buildStaffSchedulePdfHtml(rows, { clientLabel: 'Cliente', monthLabel: 'julho de 2026' });
  const excel = buildStaffScheduleExcelHtml(rows, { clientLabel: 'Cliente', periodLabel: '08/07/2026' });

  assert.equal(pdf.includes('62,50€'), true);
  assert.equal(excel.includes('62,50€'), true);
  assert.equal(pdf.includes('Valor/h'), false);
  assert.equal(excel.includes('Valor/h'), false);
  assert.equal(pdf.includes('12,50€'), false);
  assert.equal(excel.includes('12,50€'), false);
  assert.equal(pdf.includes('37,50€'), false);
  assert.equal(pdf.includes('25,00€'), false);
  assert.equal(excel.includes('37,50€'), false);
  assert.equal(excel.includes('25,00€'), false);
});

test('uses billable client hours for the event total in pdf and excel exports', () => {
  const rows = [
    {
      event: {
        id: 1,
        name: 'Evento com mínimo',
        client: { name: 'Cliente' },
        date: '2026-07-08',
        requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 10 }]),
      },
      assignment: { collaborator: { shortName: 'Ana' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
      staffScheduleHours: 3,
      clientHours: 5,
    },
  ];

  const pdf = buildStaffSchedulePdfHtml(rows);
  const excel = buildStaffScheduleExcelHtml(rows);

  assert.equal(pdf.includes('50,00€'), true);
  assert.equal(excel.includes('50,00€'), true);
  assert.equal(pdf.includes('3:00h'), true);
});

test('shows the document total value next to the general hours in pdf and excel exports', () => {
  const rows = [
    {
      event: {
        id: 1,
        name: 'Almoço',
        client: { name: 'Cliente' },
        date: '2026-07-08',
        requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 10 }]),
      },
      assignment: { collaborator: { shortName: 'Ana' }, role: 'Staff', checkIn: '09:00', checkOut: '12:00' },
      staffScheduleHours: 3,
    },
    {
      event: {
        id: 2,
        name: 'Jantar',
        client: { name: 'Cliente' },
        date: '2026-07-09',
        requiredRoles: JSON.stringify([{ role: 'Staff', agreedRate: 12.5 }]),
      },
      assignment: { collaborator: { shortName: 'Rui' }, role: 'Staff', checkIn: '18:00', checkOut: '22:00' },
      staffScheduleHours: 4,
    },
  ];

  const pdf = buildStaffSchedulePdfHtml(rows, { clientLabel: 'Cliente', periodLabel: '08/07/2026 a 09/07/2026' });
  const excel = buildStaffScheduleExcelHtml(rows, { clientLabel: 'Cliente', periodLabel: '08/07/2026 a 09/07/2026' });

  assert.equal(pdf.includes('Total geral de horas Staff'), true);
  assert.equal(pdf.includes('Valor total dos serviços'), true);
  assert.equal(pdf.includes('7:00h'), true);
  assert.equal(pdf.includes('80,00€'), true);
  assert.equal(excel.includes('Total geral de horas Staff'), true);
  assert.equal(excel.includes('Valor total dos serviços'), true);
  assert.equal(excel.includes('7:00h'), true);
  assert.equal(excel.includes('80,00€'), true);
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
  assert.equal(html.includes('3:00h'), true);
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
  assert.equal(csv.includes('3:00h'), true);
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
  assert.equal(html.includes('7:30h'), true);
  assert.equal(html.includes('mso-number-format'), true);
});

test('includes collaborator NIF in Excel and CSV staff exports', () => {
  const rows = [{
    event: { id: 1, name: 'Evento', client: { name: 'Cliente' }, date: '2026-07-08' },
    assignment: {
      collaborator: { shortName: 'Ana', nif: '123456789' },
      role: 'Staff',
      checkIn: '09:00',
      checkOut: '12:00',
    },
    staffScheduleHours: 3,
  }];

  const excel = buildStaffScheduleExcelHtml(rows);
  const csv = buildStaffScheduleCsv(rows);

  assert.equal(excel.includes('<td>NIF</td>'), true);
  assert.equal(excel.includes('<td>123456789</td>'), true);
  assert.equal(csv.includes('NIF'), true);
  assert.equal(csv.includes('123456789'), true);
});

test('only includes work locations in exports for events that explicitly enable them', () => {
  const disabledRows = [{
    event: {
      id: 1,
      name: 'Evento simples',
      client: { name: 'Cliente' },
      date: '2026-07-08',
      workLocationsEnabled: false,
    },
    assignment: {
      collaborator: { shortName: 'Ana' },
      role: 'Staff',
      checkIn: '09:00',
      checkOut: '12:00',
      workLocation: { name: 'Lounge A' },
    },
    staffScheduleHours: 3,
  }];

  const enabledRows = [{
    event: {
      id: 2,
      name: 'Evento com áreas',
      client: { name: 'Cliente' },
      date: '2026-07-08',
      workLocationsEnabled: true,
    },
    assignment: {
      collaborator: { shortName: 'Rui' },
      role: 'Staff',
      checkIn: '09:00',
      checkOut: '12:00',
      workLocation: { name: 'Lounge VIP' },
    },
    staffScheduleHours: 3,
  }];

  assert.equal(buildStaffSchedulePdfHtml(disabledRows).includes('Local de Trabalho'), false);
  assert.equal(buildStaffScheduleCsv(disabledRows).includes('Local de Trabalho'), false);
  assert.equal(buildStaffScheduleExcelHtml(disabledRows).includes('Local de Trabalho'), false);

  const pdf = buildStaffSchedulePdfHtml(enabledRows);
  const csv = buildStaffScheduleCsv(enabledRows);
  const excel = buildStaffScheduleExcelHtml(enabledRows);

  assert.equal(pdf.includes('Local de Trabalho'), true);
  assert.equal(pdf.includes('Lounge VIP'), true);
  assert.equal(csv.includes('Local de Trabalho'), true);
  assert.equal(csv.includes('Lounge VIP'), true);
  assert.equal(excel.includes('Local de Trabalho'), true);
  assert.equal(excel.includes('Lounge VIP'), true);
});

test('keeps Portuguese accents intact in PDF and Excel exports', () => {
  const rows = [{
    event: {
      id: 1,
      name: 'Serviço de verão',
      client: { name: 'Fundação São João' },
      date: '2026-07-08',
      location: 'Lisboa',
      requiredRoles: JSON.stringify([{ role: 'Função', agreedRate: 10 }]),
    },
    assignment: {
      collaborator: { shortName: 'João Silva' },
      role: 'Função',
      checkIn: '09:00',
      checkOut: '12:00',
    },
    staffScheduleHours: 3,
  }];

  const pdf = buildStaffSchedulePdfHtml(rows, { clientLabel: 'Fundação São João' });
  const excel = buildStaffScheduleExcelHtml(rows, { clientLabel: 'Fundação São João' });
  const mojibake = /(?:\u00c3[\u00a1\u00a2\u00a3\u00a7\u00a9\u00aa\u00ad\u00b3\u00ba]|\u00c2[\u00ab\u00bb\u00b7]|\u00c3\u0192|\u00ef\u00bf\u00bd)/u;

  for (const output of [pdf, excel]) {
    assert.equal(output.includes('Serviço de verão'), true);
    assert.equal(output.includes('João Silva'), true);
    assert.equal(output.includes('Função'), true);
    assert.equal(mojibake.test(output), false);
  }
});
