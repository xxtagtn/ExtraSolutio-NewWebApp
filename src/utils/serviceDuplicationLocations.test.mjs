import assert from 'node:assert/strict';
import test from 'node:test';
import XLSXModule from 'xlsx-js-style';
import { assignmentDraftsFromRows } from './serviceAssignmentDrafts.js';
import { createEventAttendanceWorkbook } from './eventAttendanceExcel.js';
import {
  buildServiceDuplicateForm, createDuplicatePeriodDraft,
  resolveDuplicatedServiceWorkLocations, updateDuplicatePeriodDraft,
} from './serviceDuplication.js';

const XLSX = XLSXModule.default || XLSXModule;
function sourceEvent(isContinuous = false) {
  const days = isContinuous ? ['2026-10-10', '2026-10-11', '2026-10-12'] : ['2026-10-10'];
  return {
    id: 12, name: 'Lounges QA', date: days[0], endDate: days.at(-1), isContinuous,
    workLocationsEnabled: true,
    workLocations: [40, 60, 20].map((id, index) => ({ id, eventId: 12, name: `Lounge ${index + 1}`, sortOrder: index })),
    requiredRoles: days.map((day) => ({ day, role: 'Emp.Mesa', qty: 4 })),
    assignments: days.flatMap((day, dayIndex) => [40, 60, 20, 40].map((workLocationId, index) => ({
      id: dayIndex * 4 + index + 1, collaboratorId: index + 1, assignmentDate: day,
      role: index === 2 ? 'Bar' : 'Emp.Mesa', status: 'confirmed', workLocationId,
      plannedCheckIn: '10:00', plannedCheckOut: '18:00',
    }))),
  };
}
const destination = {
  id: 100,
  workLocations: [
    { id: 900, eventId: 100, name: 'Lounge 3' },
    { id: 700, eventId: 100, name: 'Lounge 1' },
    { id: 800, eventId: 100, name: 'Lounge 2' },
  ],
};

test('copied team uses temporary location references then actual new IDs, not positions or original IDs', () => {
  const original = sourceEvent();
  const snapshot = structuredClone(original);
  const draft = buildServiceDuplicateForm(original, {}, { includeTeam: true });
  assert.deepEqual(draft.assignments.map((row) => row.workLocationId), ['', '', '', '']);
  const beforeSave = resolveDuplicatedServiceWorkLocations(draft);
  assert.deepEqual(beforeSave.workLocations, ['Lounge 1', 'Lounge 2', 'Lounge 3']);
  assert.ok(beforeSave.assignments.every((row) => !('duplicateWorkLocationKey' in row)));
  const resolved = resolveDuplicatedServiceWorkLocations(draft, destination);
  assert.deepEqual(resolved.assignments.map((row) => row.workLocationId), ['700', '800', '900', '700']);
  assert.deepEqual(resolved.assignments.map((row) => row.status), Array(4).fill('pending_confirmation'));
  assert.deepEqual(original, snapshot);
});

test('without copying a team, location creation and unassigned planned slots retain existing behavior', () => {
  const draft = buildServiceDuplicateForm(sourceEvent(), {});
  assert.ok(draft.assignments.every((row) => !row.collaboratorId && !row.workLocationId && !row.duplicateWorkLocationKey));
  assert.deepEqual(resolveDuplicatedServiceWorkLocations(draft, destination).workLocations, ['Lounge 1', 'Lounge 2', 'Lounge 3']);
});

test('date trimming, restoration and relocation retain each day, function and location association', () => {
  const original = sourceEvent(true);
  let current = { form: buildServiceDuplicateForm(original, {}, { includeTeam: true }) };
  current.retained = createDuplicatePeriodDraft(current.form);
  current = updateDuplicatePeriodDraft({ ...current.form, endDate: '2026-10-10' }, current.retained);
  assert.equal(current.form.assignments.length, 4);
  current = updateDuplicatePeriodDraft({ ...current.form, endDate: '2026-10-12' }, current.retained);
  current = updateDuplicatePeriodDraft({ ...current.form, date: '2026-11-01', endDate: '2026-11-02' }, current.retained, { relocate: true });
  const mapped = resolveDuplicatedServiceWorkLocations(current.form, destination);
  assert.equal(mapped.assignments.length, 8, 'third day is not saved or restored outside final period');
  for (const day of ['2026-11-01', '2026-11-02']) {
    assert.deepEqual(mapped.assignments.filter((row) => row.assignmentDate === day).map((row) => [row.role, row.workLocationId]),
      [['Emp.Mesa', '700'], ['Emp.Mesa', '800'], ['Bar', '900'], ['Emp.Mesa', '700']]);
  }
});

test('renaming and deleting draft locations cannot assign a collaborator to the next location by index', () => {
  const draft = buildServiceDuplicateForm(sourceEvent(), {}, { includeTeam: true });
  draft.workLocations[0].name = 'Lounge VIP';
  draft.workLocations.splice(1, 1);
  const mapped = resolveDuplicatedServiceWorkLocations(draft, { id: 100, workLocations: [
    { id: 910, eventId: 100, name: 'Lounge 3' }, { id: 710, eventId: 100, name: 'Lounge VIP' },
  ] });
  assert.deepEqual(mapped.assignments.map((row) => row.workLocationId), ['710', '', '910', '710']);
});

test('unknown or disabled source locations are not guessed; disabling the draft clears associations', () => {
  const original = sourceEvent();
  original.assignments[0].workLocationId = 999;
  const draft = buildServiceDuplicateForm(original, {}, { includeTeam: true });
  assert.equal(draft.assignments[0].duplicateWorkLocationKey, undefined);
  assert.equal(resolveDuplicatedServiceWorkLocations(draft, destination).assignments[0].workLocationId, '');
  draft.workLocationsEnabled = false;
  assert.ok(resolveDuplicatedServiceWorkLocations(draft, { id: 100 }).assignments.every((row) => !row.workLocationId));
  original.workLocationsEnabled = false;
  assert.ok(buildServiceDuplicateForm(original, {}, { includeTeam: true }).assignments.every((row) => !row.duplicateWorkLocationKey));
});

test('destination matching respects server name normalization and rejects missing or foreign locations', () => {
  const draft = buildServiceDuplicateForm(sourceEvent(), {}, { includeTeam: true });
  draft.workLocations[0].name = '  LOUNGE   1  ';
  assert.equal(resolveDuplicatedServiceWorkLocations(draft, destination).assignments[0].workLocationId, '700');
  assert.throws(() => resolveDuplicatedServiceWorkLocations(draft, { id: 100, workLocations: [] }), /local de trabalho/);
  assert.throws(() => resolveDuplicatedServiceWorkLocations(draft, { id: 100, workLocations: sourceEvent().workLocations }), /local de trabalho/);
});

test('editing a duplicate association does not change source data or another day of the same collaborator', () => {
  const original = sourceEvent(true);
  const snapshot = structuredClone(original);
  const draft = buildServiceDuplicateForm(original, {}, { includeTeam: true });
  draft.assignments[0].duplicateWorkLocationKey = draft.workLocations[2].duplicateLocationKey;
  const mapped = resolveDuplicatedServiceWorkLocations(draft, destination);
  assert.equal(mapped.assignments[0].workLocationId, '900');
  assert.equal(mapped.assignments[4].workLocationId, '700');
  assert.deepEqual(original, snapshot);
});

test('unassigning a copied collaborator leaves a draft that resolves to new location IDs without temporary keys', () => {
  const draft = buildServiceDuplicateForm(sourceEvent(), {}, { includeTeam: true });
  draft.assignments[0].collaboratorId = '';
  const before = assignmentDraftsFromRows(resolveDuplicatedServiceWorkLocations(draft).assignments);
  const after = assignmentDraftsFromRows(resolveDuplicatedServiceWorkLocations(draft, destination).assignments);
  assert.equal(before[0].workLocationId, '');
  assert.equal(after[0].workLocationId, '700');
  assert.ok(!JSON.stringify(after).includes('duplicate-location'));
});

test('generated Excel retains correct location names on each duplicated event day after XLSX serialization', () => {
  for (const continuous of [false, true]) {
    const draft = buildServiceDuplicateForm(sourceEvent(continuous), {}, { includeTeam: true });
    const mapped = resolveDuplicatedServiceWorkLocations(draft, destination);
    const event = { ...mapped, id: destination.id };
    for (const selectedDay of continuous ? ['2026-10-10', '2026-10-11', '2026-10-12'] : ['2026-10-10']) {
      const { workbook, rows } = createEventAttendanceWorkbook({ XLSX, event, selectedDay,
        assignments: mapped.assignments, workLocations: destination.workLocations,
        collaborators: [1, 2, 3, 4].map((id) => ({ id, name: `Pessoa ${id}` })),
      });
      const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const reloaded = XLSX.read(file, { type: 'buffer' }).Sheets['Registo de Horas'];
      assert.deepEqual(Object.fromEntries(rows.map((row, index) => [reloaded[`B${index + 9}`].v, reloaded[`E${index + 9}`].v])),
        { 'Pessoa 1': 'Lounge 1', 'Pessoa 2': 'Lounge 2', 'Pessoa 3': 'Lounge 3', 'Pessoa 4': 'Lounge 1' });
    }
  }
});
