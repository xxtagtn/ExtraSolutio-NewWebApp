import assert from 'node:assert/strict';
import test from 'node:test';
import XLSXModule from 'xlsx-js-style';
import {
  applyAttendancePrintSettings,
  buildEventAttendanceRows,
  createEventAttendanceWorkbook,
  eventAttendanceFilename,
} from './eventAttendanceExcel.js';

const XLSX = XLSXModule.default || XLSXModule;

const collaborators = [
  { id: 1, name: 'Ana Silva', shortName: 'Ana', nif: '123456789' },
  { id: 2, name: 'Bruno Costa', shortName: 'Bruno', nif: '987654321' },
];

test('builds only assigned, active rows from the selected continuous-event day', () => {
  const rows = buildEventAttendanceRows({
    assignments: [
      {
        id: 10,
        collaboratorId: 1,
        assignmentDate: '2026-08-01',
        role: 'Emp.Mesa',
        plannedCheckIn: '10:00',
        plannedCheckOut: '16:00',
        workLocationId: 5,
      },
      {
        id: 11,
        collaboratorId: 2,
        assignmentDate: '2026-08-02',
        role: 'Barman',
        plannedCheckIn: '17:00',
        plannedCheckOut: '23:00',
      },
      {
        id: 12,
        collaboratorId: '',
        assignmentDate: '2026-08-01',
        role: 'Copa',
      },
      {
        id: 13,
        collaboratorId: 2,
        assignmentDate: '2026-08-01',
        role: 'Barman',
        status: 'cancelled',
      },
    ],
    collaborators,
    workLocations: [{ id: 5, name: 'Lounge A' }],
    selectedDay: '2026-08-01',
    isContinuous: true,
  });

  assert.deepEqual(rows, [{
    index: 1,
    collaborator: 'Ana Silva',
    nif: '123456789',
    role: 'Emp.Mesa',
    workLocation: 'Lounge A',
    plannedSchedule: '10:00 - 16:00',
    actualCheckIn: '',
    actualCheckOut: '',
    signature: '',
    notes: '',
  }]);
});

test('keeps separate shifts for the same collaborator', () => {
  const rows = buildEventAttendanceRows({
    assignments: [
      {
        id: 20,
        collaboratorId: 1,
        role: 'Emp.Mesa',
        plannedCheckIn: '11:30',
        plannedCheckOut: '16:00',
      },
      {
        id: 21,
        collaboratorId: 1,
        role: 'Emp.Mesa',
        plannedCheckIn: '19:00',
        plannedCheckOut: '23:00',
      },
    ],
    collaborators,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].plannedSchedule, '11:30 - 16:00');
  assert.equal(rows[1].plannedSchedule, '19:00 - 23:00');
});

test('creates a styled workbook with event metadata and attendance columns', () => {
  const { workbook, rows } = createEventAttendanceWorkbook({
    XLSX,
    event: {
      name: 'Jantar Institucional',
      client: { name: 'Cliente Exemplo' },
      serviceReference: 'Sala Lisboa',
      location: 'Lisboa',
      date: '2026-08-01',
      isContinuous: true,
    },
    selectedDay: '2026-08-01',
    assignments: [{
      id: 30,
      collaboratorId: 1,
      assignmentDate: '2026-08-01',
      role: 'Emp.Mesa',
      plannedCheckIn: '18:00',
      plannedCheckOut: '23:30',
    }],
    collaborators,
  });

  const sheet = workbook.Sheets['Registo de Horas'];
  assert.equal(rows.length, 1);
  assert.equal(sheet.A1.v, 'Folha de Registo de Horas');
  assert.equal(sheet.B4.v, 'Jantar Institucional');
  assert.equal(sheet.F4.v, 'Cliente Exemplo');
  assert.equal(sheet.B6.v, 'Sala Lisboa');
  assert.equal(sheet.B9.v, 'Ana Silva');
  assert.equal(sheet.F9.v, '18:00 - 23:30');
  assert.equal(sheet.G9.v, '');
  assert.equal(sheet.I9.v, '');
  assert.equal(sheet['!autofilter'].ref, 'A8:J9');
  assert.equal(sheet['!pageSetup'].orientation, 'landscape');
  assert.equal(sheet['!pageSetup'].fitToWidth, 1);
  assert.equal(sheet['!pageSetup'].fitToHeight, 1);
  assert.equal(sheet['!margins'].left, 0.1);
  assert.equal(sheet['!rows'][8].hpt, 18);
  assert.deepEqual(
    sheet['!cols'].map((column) => column.wch),
    [5, 26, 13, 16, 17, 16, 11, 11, 20, 24],
  );
});

test('configures one-page printing for up to 30 collaborators and paginates larger sheets', () => {
  const assignments = Array.from({ length: 30 }, (_, index) => ({
    id: 100 + index,
    collaboratorId: 1,
    role: 'Emp.Mesa',
    plannedCheckIn: '10:00',
    plannedCheckOut: '16:00',
  }));
  const compact = createEventAttendanceWorkbook({
    XLSX,
    event: { name: 'Evento 30 pessoas', date: '2026-08-01' },
    selectedDay: '2026-08-01',
    assignments,
    collaborators,
  });
  assert.equal(compact.rows.length, 30);
  assert.equal(compact.fitToHeight, 1);
  assert.equal(compact.sheet['!pageSetup'].fitToHeight, 1);
  assert.equal(compact.sheet['!rows'][8].hpt, 18);

  const larger = createEventAttendanceWorkbook({
    XLSX,
    event: { name: 'Evento maior', date: '2026-08-01' },
    selectedDay: '2026-08-01',
    assignments: [...assignments, {
      id: 130,
      collaboratorId: 2,
      role: 'Emp.Mesa',
      plannedCheckIn: '10:00',
      plannedCheckOut: '16:00',
    }],
    collaborators,
  });
  assert.equal(larger.rows.length, 31);
  assert.equal(larger.fitToHeight, 0);
  assert.equal(larger.sheet['!pageSetup'].fitToHeight, 0);
});

test('writes print-fit settings into the generated XLSX worksheet', async () => {
  const { workbook, fitToHeight } = createEventAttendanceWorkbook({
    XLSX,
    event: { name: 'Evento de teste', date: '2026-08-01' },
    selectedDay: '2026-08-01',
    assignments: [{
      id: 40,
      collaboratorId: 1,
      role: 'Emp.Mesa',
      plannedCheckIn: '10:00',
      plannedCheckOut: '16:00',
    }],
    collaborators,
  });
  const rawContent = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true, cellStyles: true });
  const content = await applyAttendancePrintSettings(rawContent, fitToHeight);
  const { unzipSync } = await import('fflate');
  const xml = new globalThis.TextDecoder().decode(unzipSync(new Uint8Array(content))['xl/worksheets/sheet1.xml']);
  assert.match(xml, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(xml, /<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"\/>/);
  const pageMarginsIndex = xml.indexOf('<pageMargins');
  const pageSetupIndex = xml.indexOf('<pageSetup');
  const ignoredErrorsIndex = xml.indexOf('<ignoredErrors');
  assert.ok(pageMarginsIndex >= 0);
  assert.ok(pageSetupIndex > pageMarginsIndex);
  assert.ok(ignoredErrorsIndex < 0 || pageSetupIndex < ignoredErrorsIndex);
  assert.ok(pageSetupIndex < xml.indexOf('</worksheet>'));
});

test('creates a safe and identifiable xlsx filename', () => {
  assert.equal(
    eventAttendanceFilename({ name: 'Jantar: Direção / VIP' }, '2026-08-01'),
    'Folha de Registo de Horas - Jantar Direcao VIP - 20260801.xlsx',
  );
});
