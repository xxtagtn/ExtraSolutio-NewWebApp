import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentUpdateChanges, buildServiceTeamSavePlan } from './serviceTeamSavePlan.js';
import { buildEditableTeamRows, normalizeDailyRoleRequirements } from './serviceDetail.js';

function fixture() {
  const days = Array.from({ length: 26 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  return { id: 10, date: days[0], endDate: days.at(-1), isContinuous: true, startTime: '10:00', endTime: '18:00',
    requiredRoles: days.map(day => ({ role: 'Emp.Mesa', qty: 3, agreedRate: 12, day })),
    assignments: Array.from({ length: 78 }, (_, i) => ({ id: i + 1, eventId: 10, collaboratorId: i + 1,
      role: 'Emp.Mesa', assignmentDate: `${days[Math.floor(i / 3)]}T00:00:00.000Z`, plannedCheckIn: '10:00', plannedCheckOut: '18:00',
      hourlyRate: '8.00', status: 'confirmed', clientSynced: true, isDriver: false,
      checkIn: '10:05', checkOut: '18:15', paymentStatus: 'paid', totalPay: 64, validationStatus: 'validated', advancePayments: '[]' })) };
}

test('78 assignments across 26 days produce no writes when nothing changed', () => {
  const source = fixture(), before = structuredClone(source);
  const plan = buildServiceTeamSavePlan(source, buildEditableTeamRows(source), normalizeDailyRoleRequirements(source));
  assert.deepEqual(plan, { creates: [], updates: [], removedIds: [], servicePatch: {}, changed: false });
  assert.deepEqual(source, before);
});

test('one changed row out of 78 sends one changed field, not 78 full assignments', () => {
  const source = fixture(), rows = buildEditableTeamRows(source);
  rows[50].hourlyRate = '8,50';
  const plan = buildServiceTeamSavePlan(source, rows, normalizeDailyRoleRequirements(source));
  assert.deepEqual(plan.updates, [{ id: 51, data: { hourlyRate: 8.5 } }]);
  assert.equal(plan.creates.length, 0); assert.equal(plan.removedIds.length, 0);
  assert.deepEqual(plan.servicePatch, {});
  assert.equal(source.assignments[50].paymentStatus, 'paid');
  assert.equal(source.assignments[50].checkIn, '10:05');
});

test('changes on different days remain separate and retain confirmation/sync values', () => {
  const source = fixture(), rows = buildEditableTeamRows(source);
  rows[0].clientSynced = false;
  rows[77].status = 'pending_confirmation';
  const plan = buildServiceTeamSavePlan(source, rows, normalizeDailyRoleRequirements(source));
  assert.deepEqual(plan.updates, [{ id: 1, data: { clientSynced: false } }, { id: 78, data: { status: 'pending_confirmation' } }]);
});

test('new allocations and removals still use the existing create/delete flow', () => {
  const source = fixture(), rows = buildEditableTeamRows(source).filter(row => row.id !== 77);
  rows.push({ ...rows[0], id: undefined, rowKey: 'new-row', collaboratorId: '200' });
  const plan = buildServiceTeamSavePlan(source, rows, normalizeDailyRoleRequirements(source));
  assert.deepEqual(plan.removedIds, [77]); assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].collaboratorId, 200); assert.equal(plan.updates.length, 0);
});

test('cancelled days never trigger deletes, updates or recreation of their assignments', () => {
  const source = { ...fixture(), cancelledDays: ['2026-10-26'] };
  const rows = buildEditableTeamRows(source).filter(row => row.id < 76);
  const plan = buildServiceTeamSavePlan(source, rows, normalizeDailyRoleRequirements(source));
  assert.deepEqual(plan.removedIds, []); assert.deepEqual(plan.updates, []); assert.deepEqual(plan.creates, []);
});

test('unchanged generated vacancies and saved drafts do not require resaving the event', () => {
  for (const source of [{ ...fixture(), assignments: [] }, { ...fixture(), assignments: [],
    assignmentDrafts: '[{"draftId":"saved-1","role":"Emp.Mesa","assignmentDate":"2026-10-01","status":"pending_confirmation"}]' }]) {
    const roles = normalizeDailyRoleRequirements(source), rows = buildEditableTeamRows(source);
    assert.equal(buildServiceTeamSavePlan(source, rows, roles).changed, false);
    rows[0].plannedCheckIn = '09:00';
    assert.ok(buildServiceTeamSavePlan(source, rows, roles).servicePatch.assignmentDrafts.length);
  }
});

test('role configuration changes save only event metadata, not unchanged assigned people', () => {
  const source = fixture(), rows = buildEditableTeamRows(source), roles = normalizeDailyRoleRequirements(source);
  roles[0].agreedRate = 13;
  const plan = buildServiceTeamSavePlan(source, rows, roles);
  assert.deepEqual(Object.keys(plan.servicePatch), ['requiredRoles']);
  assert.deepEqual(plan.updates, []); assert.equal(plan.changed, true);
});

test('normal comparison handles serialized decimals, dates, flags, empty times and advances', () => {
  const original = { id: 1, eventId: 10, collaboratorId: 2, assignmentDate: '2026-10-01T00:00:00Z',
    hourlyRate: '8.00', totalPay: 64, clientSynced: true, isDriver: false, plannedCheckOut: null, advancePayments: '[{"amount":10}]' };
  assert.deepEqual(assignmentUpdateChanges({ ...original, id: '1', eventId: '10', collaboratorId: '2', assignmentDate: '2026-10-01',
    hourlyRate: 8, totalPay: '64,00', clientSynced: 1, isDriver: 0, plannedCheckOut: '', advancePayments: [{ amount: 10 }] }, original), {});
  assert.deepEqual(assignmentUpdateChanges({ plannedCheckOut: null, hourlyRate: 0 }, { plannedCheckOut: '18:00', hourlyRate: 8 }), { plannedCheckOut: null, hourlyRate: 0 });
});
