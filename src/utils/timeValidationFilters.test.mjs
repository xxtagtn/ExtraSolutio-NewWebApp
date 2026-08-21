import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareTimeValidationRows,
  dateKeysFrom,
  effectiveRowDateKey,
  effectiveRowStartTime,
  filterValidationRowsByCollaborator,
  filterRowsByDateRange,
  filterRowsBySelectedDays,
  localDayNumber,
  matchesValidationClientFilter,
  normalizeTimeInput,
  sanitizeTimeInput,
  validationClientFilterKey,
  validationCollaboratorFilterKey,
  validationCollaboratorFilterIdentity,
  validationClientFilterIdentity,
  validationWorkLocationLabel,
  matchesValidationCollaboratorFilter,
} from './timeValidationFilters.js';

test('gets the local day number from an event date', () => {
  assert.equal(localDayNumber('2026-07-08T00:00:00.000Z'), 8);
});

test('filters validation rows by one or more selected days', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' } },
  ];

  assert.deepEqual(filterRowsBySelectedDays(rows, [3, 12]).map((row) => row.id), [1, 3]);
});

test('uses assignment date instead of event date for validation row dates', () => {
  const row = {
    event: { date: '2026-07-01' },
    assignment: { assignmentDate: '2026-07-04T00:00:00.000Z' },
  };

  assert.equal(effectiveRowDateKey(row), '2026-07-04');
});

test('uses planned assignment start as effective row start time', () => {
  const row = {
    event: { startTime: '09:00' },
    assignment: { plannedCheckIn: '14:00', checkIn: '15:00' },
  };

  assert.equal(effectiveRowStartTime(row), '14:00');
});

test('sorts validation rows by date and collaborator name', () => {
  const rows = [
    { id: 3, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-02', plannedCheckIn: '08:00', collaborator: { shortName: 'Ana' } } },
    { id: 1, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '08:00', collaborator: { shortName: 'Rui' } } },
    { id: 2, event: { name: 'Evento', date: '2026-07-01', startTime: '09:00' }, assignment: { assignmentDate: '2026-07-01', plannedCheckIn: '10:00', collaborator: { shortName: 'Marta' } } },
  ];

  assert.deepEqual([...rows].sort(compareTimeValidationRows).map((row) => row.id), [2, 1, 3]);
});

test('shows only the assigned work location when the event enables locations', () => {
  const assignment = { workLocation: { name: 'Lounge VIP' } };

  assert.equal(validationWorkLocationLabel({ workLocationsEnabled: true }, assignment), 'Lounge VIP');
  assert.equal(validationWorkLocationLabel({ workLocationsEnabled: false }, assignment), '');
  assert.equal(validationWorkLocationLabel({ workLocationsEnabled: true }, {}), '');
});

test('sorts validation rows by resolved work date before grouping by day', () => {
  const rows = [
    { id: 1, workDateKey: '2026-06-02', event: { name: 'Evento', date: '2026-06-01' }, assignment: { plannedCheckIn: '10:00', collaborator: { shortName: 'Ana' } } },
    { id: 2, workDateKey: '2026-06-01', event: { name: 'Evento', date: '2026-06-01' }, assignment: { plannedCheckIn: '12:00', collaborator: { shortName: 'Rui' } } },
    { id: 3, workDateKey: '2026-06-06', event: { name: 'Evento', date: '2026-06-01' }, assignment: { plannedCheckIn: '09:00', collaborator: { shortName: 'Debora' } } },
    { id: 4, workDateKey: '2026-06-03', event: { name: 'Evento', date: '2026-06-01' }, assignment: { plannedCheckIn: '08:00', collaborator: { shortName: 'Diego' } } },
    { id: 5, workDateKey: '2026-06-01', event: { name: 'Evento', date: '2026-06-01' }, assignment: { plannedCheckIn: '08:00', collaborator: { shortName: 'Marta' } } },
  ];

  assert.deepEqual([...rows].sort(compareTimeValidationRows).map((row) => row.id), [5, 2, 1, 4, 3]);
});

test('keeps collaborator order stable while staff and client times are edited', () => {
  const rows = [
    {
      id: 1,
      collaboratorName: 'Rui',
      event: { name: 'Evento', date: '2026-07-01' },
      assignment: { collaborator: { shortName: 'Rui' } },
    },
    {
      id: 2,
      collaboratorName: 'Ana',
      event: { name: 'Evento', date: '2026-07-01' },
      assignment: { collaborator: { shortName: 'Ana' } },
    },
  ];

  const initialOrder = [...rows].sort(compareTimeValidationRows).map((row) => row.id);
  const editedRows = rows.map((row) => (
    row.id === 1
      ? { ...row, assignment: { ...row.assignment, checkIn: '08:00', checkOut: '17:00', clientCheckIn: '08:15' } }
      : row
  ));

  assert.deepEqual(initialOrder, [2, 1]);
  assert.deepEqual([...editedRows].sort(compareTimeValidationRows).map((row) => row.id), initialOrder);
});

test('normalizes date key collections from sets', () => {
  assert.deepEqual(dateKeysFrom(new Set(['2026-07-04', '', '2026-07-05'])), ['2026-07-04', '2026-07-05']);
});

test('filters selected days by assignment date when present', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' }, assignment: {} },
  ];

  assert.deepEqual(filterRowsBySelectedDays(rows, [3, 12]).map((row) => row.id), [1, 3]);
});

test('keeps all validation rows when no day is selected', () => {
  const rows = [{ id: 1, event: { date: '2026-07-03' } }];

  assert.deepEqual(filterRowsBySelectedDays(rows, []).map((row) => row.id), [1]);
});

test('filters validation rows inside a date range', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' } },
  ];

  assert.deepEqual(filterRowsByDateRange(rows, '2026-07-04', '2026-07-10').map((row) => row.id), [2]);
});

test('filters date range by assignment date when present', () => {
  const rows = [
    { id: 1, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-03' } },
    { id: 2, event: { date: '2026-07-01' }, assignment: { assignmentDate: '2026-07-08' } },
    { id: 3, event: { date: '2026-07-12' }, assignment: {} },
  ];

  assert.deepEqual(filterRowsByDateRange(rows, '2026-07-04', '2026-07-10').map((row) => row.id), [2]);
});

test('normalizes validation client filter keys across API response shapes', () => {
  assert.equal(validationClientFilterKey({ clientId: 12, client: { id: 99, name: 'Cliente A' } }), 'id:12');
  assert.equal(validationClientFilterKey({ client: { id: 12, name: 'Cliente A' } }), 'id:12');
  assert.equal(validationClientFilterKey({ clientName: 'Cliente ocasional' }), 'name:cliente ocasional');
  assert.equal(validationClientFilterKey({}), 'unassigned');
  assert.equal(matchesValidationClientFilter({ clientId: 12, client: { id: 99 } }, 'id:99'), false);
  assert.equal(matchesValidationClientFilter({ clientId: 12, client: { id: 99 } }, '99'), false);
  assert.equal(matchesValidationClientFilter({ clientId: 12, client: { id: 99 } }, 'id:12'), true);
  assert.equal(matchesValidationClientFilter({ clientId: 12, client: { id: 99 } }, 'id:77'), false);
  assert.equal(matchesValidationClientFilter({ clientName: 'Cliente ocasional' }, 'name:cliente ocasional'), true);
});

test('normalizes validation collaborator filter keys across API response shapes', () => {
  assert.equal(validationCollaboratorFilterKey({ collaboratorId: 12, collaborator: { id: 99 } }), 'id:12');
  assert.equal(validationCollaboratorFilterKey({ staffId: 12 }), 'id:12');
  assert.equal(validationCollaboratorFilterKey({ collaborator: { id: 12 } }), 'id:12');
  assert.equal(validationCollaboratorFilterKey({ collaboratorName: 'Ana Carolina Ravenna' }), 'name:ana carolina ravenna');
  assert.equal(validationCollaboratorFilterKey({ collaborator: { nif: '312330847' } }), 'nif:312330847');
  assert.equal(
    validationCollaboratorFilterKey({
      collaboratorId: 12,
      collaborator: { id: 99, name: 'Ana Carolina Ravenna', nif: '312330847' },
    }),
    'id:12',
  );
  assert.equal(validationCollaboratorFilterKey({}), '');
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12 }, 'id:12'), true);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12 }, '12'), true);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 99 }, 'id:12'), false);
  assert.equal(matchesValidationCollaboratorFilter({ collaborator: { name: 'Ana Carolina Ravenna' } }, 'name:ana carolina ravenna'), true);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 99, collaborator: { name: 'Diego Garcia Bem' } }, 'id:12'), false);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12, collaborator: { id: 99, name: 'Ana Carolina Ravenna' } }, 'id:99'), false);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12, collaborator: { id: 99, name: 'Ana Carolina Ravenna' } }, 'id:12'), true);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12, collaborator: { id: 99, name: 'Ana Carolina Ravenna' } }, 'name:ana carolina ravenna'), false);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 12, collaborator: { id: 99, name: 'Ana Carolina Ravenna' } }, 'id:77'), false);
  assert.equal(matchesValidationCollaboratorFilter({ collaboratorId: 99 }, 'all'), true);
});

test('filters complete validation collections by the selected collaborator only', () => {
  const rows = [
    { id: 1, collaboratorFilterKey: 'id:12', workDateKey: '2026-07-01' },
    { id: 2, collaboratorFilterKey: 'id:12', workDateKey: '2026-07-04' },
    { id: 3, collaboratorFilterKey: 'id:18', workDateKey: '2026-07-04' },
  ];

  assert.deepEqual(
    filterValidationRowsByCollaborator(rows, 'id:12').map((row) => row.id),
    [1, 2],
  );
  assert.deepEqual(
    filterValidationRowsByCollaborator(rows, '18').map((row) => row.id),
    [3],
  );
  assert.deepEqual(filterValidationRowsByCollaborator(rows, 'id:99'), []);
  assert.equal(filterValidationRowsByCollaborator(rows, 'all'), rows);
});

test('combines collaborator filtering with client and date filters without leaking rows', () => {
  const rows = [
    {
      id: 1,
      collaboratorFilterKey: 'id:12',
      clientFilterIdentity: { clientId: 7 },
      event: { date: '2026-07-01' },
    },
    {
      id: 2,
      collaboratorFilterKey: 'id:18',
      clientFilterIdentity: { clientId: 7 },
      event: { date: '2026-07-01' },
    },
    {
      id: 3,
      collaboratorFilterKey: 'id:12',
      clientFilterIdentity: { clientId: 9 },
      event: { date: '2026-07-01' },
    },
    {
      id: 4,
      collaboratorFilterKey: 'id:12',
      clientFilterIdentity: { clientId: 7 },
      event: { date: '2026-08-01' },
    },
  ];

  const inPeriod = filterRowsByDateRange(rows, '2026-07-01', '2026-07-31');
  const forClient = inPeriod.filter((row) => (
    matchesValidationClientFilter(row.clientFilterIdentity, 'id:7')
  ));

  assert.deepEqual(
    filterValidationRowsByCollaborator(forClient, 'id:12').map((row) => row.id),
    [1],
  );
});

test('keeps validation filter identity consistent with fallback API fields', () => {
  const assignment = validationCollaboratorFilterIdentity({
    staffId: 12,
    staffName: 'Ana Carolina Ravenna',
    staffNif: '312 330 847',
  });
  const event = validationClientFilterIdentity({
    customerId: 7,
    customer: { id: 7, name: 'SSH - Supreme Sport Hospitality' },
  });

  assert.equal(validationCollaboratorFilterKey(assignment), 'id:12');
  assert.equal(matchesValidationCollaboratorFilter(assignment, 'id:12'), true);
  assert.equal(matchesValidationCollaboratorFilter(
    validationCollaboratorFilterIdentity({ staffName: 'Ana Carolina Ravenna', staffNif: '312 330 847' }),
    'nif:312330847',
  ), true);
  assert.equal(matchesValidationCollaboratorFilter(
    validationCollaboratorFilterIdentity({ staffId: 8, staffName: 'Diego Garcia Bem', staffNif: '320 780 317' }),
    'nif:312330847',
  ), false);
  assert.equal(validationClientFilterKey(event), 'id:7');
  assert.equal(matchesValidationClientFilter(event, '7'), true);
});

test('completes an hour-only validation time with zero minutes', () => {
  assert.equal(normalizeTimeInput('14'), '14:00');
  assert.equal(normalizeTimeInput('9'), '09:00');
});

test('normalizes compact and partial-minute validation times', () => {
  assert.equal(normalizeTimeInput('1430'), '14:30');
  assert.equal(normalizeTimeInput('14:3'), '14:30');
  assert.equal(normalizeTimeInput('09:05'), '09:05');
});

test('keeps invalid validation times visible for manual correction', () => {
  assert.equal(normalizeTimeInput('25'), '25');
  assert.equal(normalizeTimeInput('14:75'), '14:75');
});

test('sanitizes validation time drafts without blocking compact input', () => {
  assert.equal(sanitizeTimeInput('14h30'), '1430');
  assert.equal(sanitizeTimeInput('14:30 extra'), '14:30');
});
