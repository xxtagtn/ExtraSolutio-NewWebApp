import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import {
  buildImportPreview,
  EVENT_NAME_MAPPING_PREFIX,
  normalizeImportMappings,
  parseTimeValidationWorkbook,
} from './timeValidationExcelImport.js';

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function fixtureBuffer() {
  return workbookBuffer([
    [],
    ['', 'SSH2526 / Relatório Final de Acessos'],
    [],
    ['', 'Data Inicial\nData Final', '2026-06-01\n2026-06-21'],
    [],
    [
      ' ',
      'Nome da Sessão',
      'Nome do Colaborador',
      'Número de Identificação',
      'NIF',
      'Entidade',
      'Departamento',
      'Categoria',
      'Data do Evento',
      'Entrada Prevista',
      'Horas de Trabalho Planeadas',
      'Valor Planeado',
      'Hora de Entrada',
      'Hora de Saída',
      'Horas Cumpridas',
    ],
    [
      '',
      'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
      'Miriam Peçanha de Oliveira',
      'GF449658',
      '326077405',
      'Extra Solutio',
      'Restaurante',
      'EMPREGADO DE MESA',
      new Date('2026-06-20T00:00:00'),
      '11:30:00',
      '04:30:00',
      40.5,
      new Date('2026-06-20T11:30:31'),
      new Date('2026-06-20T16:09:42'),
      '04:30:00',
    ],
  ]);
}

test('parses client access report with displaced header row', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());

  assert.equal(parsed.sheetName, 'Export');
  assert.equal(parsed.headerRowNumber, 6);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 7,
    sessionName: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
    collaboratorName: 'Miriam Peçanha de Oliveira',
    documentNumber: 'GF449658',
    nif: '326077405',
    entity: 'Extra Solutio',
    department: 'Restaurante',
    category: 'EMPREGADO DE MESA',
    eventDate: '2026-06-20',
    plannedCheckIn: '11:30',
    plannedHours: 4.5,
    plannedValue: 40.5,
    clientCheckIn: '11:30',
    clientCheckOut: '16:09',
    clientHours: 4.5,
  });
});

test('builds an import preview with reusable mappings and assignment match', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [
      {
        field: 'session',
        externalValue: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
        internalValue: '10',
      },
      {
        field: 'category',
        externalValue: 'EMPREGADO DE MESA',
        internalValue: 'Emp.Mesa',
      },
      {
        field: 'department',
        externalValue: 'Restaurante',
        internalValue: 'Restaurante',
      },
    ],
    collaborators: [
      { id: 20, name: 'Miriam Peçanha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-06-16',
        endDate: '2026-06-21',
        startTime: '11:30',
        endTime: '16:00',
        minimumHoursSnapshot: 0,
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', agreedRate: 10.5 }]),
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
            hourlyRate: 8,
            status: 'confirmed',
          },
        ],
      },
    ],
  });

  assert.deepEqual(preview.summary, {
    totalRows: 1,
    validRows: 1,
    invalidRows: 0,
    warningRows: 0,
    recognizedRows: 1,
    mappingRows: 0,
    blockedRows: 0,
  });
  assert.equal(preview.rows[0].status, 'valid');
  assert.equal(preview.rows[0].assignmentId, 30);
  assert.equal(preview.rows[0].clientCheckIn, '11:30');
  assert.equal(preview.rows[0].clientCheckOut, '16:09');
});

test('recalculates imported client hours from clocks instead of trusting the spreadsheet total', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  parsed.rows[0] = {
    ...parsed.rows[0],
    clientCheckIn: '17:43',
    clientCheckOut: '23:16',
    clientHours: 99,
  };
  const preview = buildImportPreview(parsed.rows, {
    mappings: [
      {
        field: 'session',
        externalValue: 'RESTAURANTE ATIVIDADES DIÃRIAS JUNHO 26',
        internalValue: '10',
      },
      {
        field: 'category',
        externalValue: 'EMPREGADO DE MESA',
        internalValue: 'Emp.Mesa',
      },
    ],
    collaborators: [
      { id: 20, name: 'Miriam PeÃ§anha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-06-16',
        endDate: '2026-06-21',
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', agreedRate: 10.5 }]),
        assignments: [{
          id: 30,
          collaboratorId: 20,
          assignmentDate: '2026-06-20',
          role: 'Emp.Mesa',
          plannedCheckIn: '11:30',
          plannedCheckOut: '16:00',
        }],
      },
    ],
  });

  assert.equal(preview.rows[0].clientRealHours, 6);
  assert.equal(preview.rows[0].clientBillableHours, 6);
});

test('matches a report session to the unique event by date and department', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    collaborators: [
      { id: 20, name: 'Miriam PeÃ§anha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
          },
        ],
      },
    ],
  });

  assert.equal(preview.rows[0].eventId, 10);
  assert.equal(preview.rows[0].assignmentId, 30);
  assert.equal(preview.rows[0].status, 'warning');
  assert.equal(preview.unresolvedMappings.session.length, 0);
});

test('does not match an event only because its date overlaps when the department differs', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    collaborators: [
      { id: 20, name: 'Miriam PeÃ§anha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Evento Hospitalidade',
        eventType: 'Hospitalidade',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [],
      },
    ],
  });

  assert.equal(preview.rows[0].eventId, null);
  assert.equal(preview.unresolvedMappings.session.length, 1);
  assert.ok(preview.rows[0].errors.some((message) => message.includes('Evento/Servi')));
});

test('matches a differently named external session to the unique event by date and department', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  parsed.rows[0].sessionName = 'EVENTO IBERCUP 25/26 OS_1061';
  const preview = buildImportPreview(parsed.rows, {
    collaborators: [
      { id: 20, name: 'Miriam PeÃ§anha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [],
      },
    ],
  });

  assert.equal(preview.rows[0].eventId, 10);
  assert.equal(preview.unresolvedMappings.session.length, 0);
});

test('uses collaborator, date and planned shift when the external session and department differ', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  parsed.rows[0].sessionName = 'BUFFET RESTAURANTE 28.06.26';
  parsed.rows[0].department = 'Hospitalidade';
  const preview = buildImportPreview(parsed.rows, {
    collaborators: [
      { id: 20, name: 'Miriam Pecanha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
          },
        ],
      },
    ],
  });

  assert.equal(preview.rows[0].eventId, 10);
  assert.equal(preview.rows[0].assignmentId, 30);
  assert.equal(preview.rows[0].status, 'warning');
  assert.equal(preview.unresolvedMappings.session.length, 0);
});

test('ignores a saved monthly session mapping outside the mapped event date range', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [
      {
        field: 'session',
        externalValue: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
        internalValue: '9',
      },
    ],
    collaborators: [
      { id: 20, name: 'Miriam Pecanha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 9,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-01',
        endDate: '2026-06-07',
        assignments: [],
      },
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
          },
        ],
      },
    ],
  });

  assert.equal(preview.rows[0].eventId, 10);
  assert.equal(preview.rows[0].assignmentId, 30);
  assert.equal(preview.rows[0].status, 'warning');
});

test('selects the compact-time shift closest to the imported planned time', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  parsed.rows[0].plannedCheckIn = '19:00';
  const preview = buildImportPreview(parsed.rows, {
    collaborators: [
      { id: 20, name: 'Miriam PeÃ§anha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        eventType: 'Restaurante',
        date: '2026-06-16',
        endDate: '2026-06-21',
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
          },
          {
            id: 31,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '19',
            plannedCheckOut: '23',
          },
        ],
      },
    ],
  });

  assert.equal(preview.rows[0].assignmentId, 31);
  assert.equal(preview.rows[0].status, 'warning');
});

test('reports unresolved mappings before import can be committed', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [],
    collaborators: [
      { id: 20, name: 'Miriam Peçanha Oliveira', nif: '326077405' },
    ],
    services: [],
  });

  assert.equal(preview.summary.totalRows, 1);
  assert.equal(preview.summary.validRows, 0);
  assert.equal(preview.summary.invalidRows, 1);
  assert.equal(preview.unresolvedMappings.session[0].externalValue, 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26');
  assert.equal(preview.unresolvedMappings.department[0].externalValue, 'Restaurante');
  assert.ok(preview.rows[0].errors.includes('Evento/Serviço não reconhecido.'));
});

test('treats missing assignments as operational blockers instead of reusable mappings', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [
      {
        field: 'session',
        externalValue: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
        internalValue: '10',
      },
      {
        field: 'category',
        externalValue: 'EMPREGADO DE MESA',
        internalValue: 'Emp.Mesa',
      },
    ],
    collaborators: [
      { id: 20, name: 'Miriam Peçanha Oliveira', nif: '326077405' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-06-20',
        startTime: '11:30',
        endTime: '16:00',
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', agreedRate: 10.5 }]),
        assignments: [],
      },
    ],
  });

  assert.equal(preview.rows[0].status, 'invalid');
  assert.equal(preview.unresolvedMappings.assignment.length, 0);
  assert.ok(preview.rows[0].errors.some((message) => message.includes('Turno') && message.includes('evento')));
});

test('uses manual collaborator mapping when the imported nif does not match the profile', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [
      {
        field: 'session',
        externalValue: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
        internalValue: '10',
      },
      {
        field: 'collaborator',
        externalValue: '326077405',
        internalValue: '20',
      },
    ],
    collaborators: [
      { id: 20, name: 'Miriam Peçanha Oliveira', nif: '999999999' },
    ],
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-06-20',
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', agreedRate: 10.5 }]),
        assignments: [
          {
            id: 30,
            collaboratorId: 20,
            assignmentDate: '2026-06-20',
            role: 'Emp.Mesa',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
            hourlyRate: 8,
            status: 'confirmed',
          },
        ],
      },
    ],
  });

  assert.equal(preview.rows[0].collaboratorId, 20);
  assert.equal(preview.rows[0].assignmentId, 30);
});

test('reuses a client event alias by event name on a later event period', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const preview = buildImportPreview(parsed.rows, {
    mappings: [{
      field: 'session',
      externalValue: 'RESTAURANTE ATIVIDADES DIÁRIAS JUNHO 26',
      internalValue: `${EVENT_NAME_MAPPING_PREFIX}Restaurante Luz Chakall`,
    }],
    collaborators: [{ id: 20, name: 'Miriam Peçanha Oliveira', nif: '326077405' }],
    services: [{
      id: 42,
      name: 'Restaurante Luz Chakall',
      date: '2026-06-20',
      assignments: [{
        id: 73,
        collaboratorId: 20,
        assignmentDate: '2026-06-20',
        role: 'Emp.Mesa',
        plannedCheckIn: '11:30',
        plannedCheckOut: '16:00',
      }],
    }],
  });

  assert.equal(preview.rows[0].eventId, 42);
  assert.equal(preview.rows[0].assignmentId, 73);
  assert.equal(preview.rows[0].resolutionType, 'recognized');
});

test('separates rows that need mapping from operationally invalid rows', () => {
  const parsed = parseTimeValidationWorkbook(fixtureBuffer());
  const needsMapping = buildImportPreview(parsed.rows, { services: [], collaborators: [] });
  assert.equal(needsMapping.summary.mappingRows, 1);
  assert.equal(needsMapping.summary.blockedRows, 0);
  assert.equal(needsMapping.rows[0].resolutionType, 'needs_mapping');

  const incompleteRows = parsed.rows.map((row) => ({ ...row, clientCheckOut: '' }));
  const invalid = buildImportPreview(incompleteRows, { services: [], collaborators: [] });
  assert.equal(invalid.summary.mappingRows, 0);
  assert.equal(invalid.summary.blockedRows, 1);
  assert.equal(invalid.rows[0].resolutionType, 'invalid');
});

test('normalizes new mappings into the active client profile', () => {
  const [mapping] = normalizeImportMappings([{
    field: 'category',
    externalValue: 'EMPREGADO DE MESA',
    internalValue: 'Emp.Mesa',
  }], 'time_validation_excel', 'client:7');

  assert.equal(mapping.scopeKey, 'client:7');
});
