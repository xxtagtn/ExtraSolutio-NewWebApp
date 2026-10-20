import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceTeamDraft, refreshServiceTeamDraft, teamDraftKey } from './serviceTeamDraft.js';

const service = (patch = {}) => ({ id: 10, date: '2026-10-20', startTime: '10:00', endTime: '18:00',
  requiredRoles: [{ role: 'Emp.Mesa', qty: 32, agreedRate: 12 }], assignments: [], ...patch });
const allocate = (draft, count) => ({ ...draft, rows: draft.rows.map((row, index) => index < count ? {
  ...row, collaboratorId: String(index + 1), status: 'confirmed', clientSynced: true, hourlyRate: 8,
} : row) });

test('32-row draft retains every allocation, confirmation and sync through metadata refreshes', () => {
  const source = service(), initial = createServiceTeamDraft(source);
  for (const count of [2, 3, 4, 32]) {
    const current = allocate(initial, count), before = structuredClone(current);
    const refreshed = refreshServiceTeamDraft(current, { ...source, updatedAt: '2026-10-20T12:00:00Z', clientFinance: { calculatedAt: 'new' } });
    assert.equal(refreshed, current);
    assert.equal(refreshed.rows.filter(row => row.clientSynced && row.status === 'confirmed').length, count);
    assert.equal(refreshed.rows.length, 32);
    assert.deepEqual(current, before);
  }
});

test('clean drafts ignore unrelated API data without rebuilding keys or hiding a picker', () => {
  const source = service(), current = createServiceTeamDraft(source);
  assert.equal(refreshServiceTeamDraft(current, { ...source, paidAmount: 50, clientFinance: { calculatedAt: 'new' } }), current);
});

test('new team data is adopted when clean but never replaces unsaved local work', () => {
  const source = service(), current = createServiceTeamDraft(source);
  const changed = { ...source, assignments: [{ id: 99, collaboratorId: 99, role: 'Emp.Mesa', status: 'confirmed' }] };
  assert.ok(refreshServiceTeamDraft(current, changed).rows.some(row => row.id === 99));
  const dirty = allocate(current, 3);
  assert.equal(refreshServiceTeamDraft(dirty, changed), dirty);
});

test('switching to a different service creates its own rows, not another event draft', () => {
  const dirty = allocate(createServiceTeamDraft(service()), 4);
  const next = refreshServiceTeamDraft(dirty, service({ id: 11, requiredRoles: [{ role: 'Bar', qty: 1 }] }));
  assert.equal(next.serviceId, 11); assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].collaboratorId, '');
  assert.equal(refreshServiceTeamDraft(next, null), next);
});

test('saved rows accept persisted IDs and a new baseline without duplicate new assignments', () => {
  const source = service(), dirty = allocate(createServiceTeamDraft(source), 2);
  const saved = createServiceTeamDraft({ ...source, assignments: dirty.rows.slice(0, 2).map((row, index) => ({ ...row, id: 100 + index })) });
  assert.equal(saved.savedKey, teamDraftKey(saved));
  assert.deepEqual(saved.rows.filter(row => row.collaboratorId).map(row => row.id), [100, 101]);
  assert.equal(saved.rows.length, 32);
});

test('role edits, unassigned rows, driver and advances are part of the draft guard', () => {
  const source = service(), initial = createServiceTeamDraft(source);
  for (const current of [
    { ...initial, roles: initial.roles.map(role => ({ ...role, qty: 33 })) },
    { ...initial, rows: initial.rows.slice(1) },
    { ...initial, rows: initial.rows.map((row, index) => index ? row : { ...row, plannedCheckIn: '09:00' }) },
    { ...allocate(initial, 1), rows: allocate(initial, 1).rows.map((row, index) => index ? row : { ...row, isDriver: true, advancePayments: [{ amount: 50 }] }) },
  ]) {
    assert.notEqual(teamDraftKey(current), initial.savedKey);
    assert.equal(refreshServiceTeamDraft(current, { ...source, startTime: '12:00' }), current);
  }
});

test('continuous days keep local edits for every day during a refresh', () => {
  const source = service({ isContinuous: true, endDate: '2026-10-21' });
  const initial = createServiceTeamDraft(source), dirty = allocate(initial, 33);
  assert.equal(dirty.rows.length, 64);
  assert.equal(refreshServiceTeamDraft(dirty, { ...source, clientFinance: { calculatedAt: 'new' } }), dirty);
  assert.equal(dirty.rows.filter(row => row.collaboratorId && row.assignmentDate === '2026-10-21').length, 1);
});
