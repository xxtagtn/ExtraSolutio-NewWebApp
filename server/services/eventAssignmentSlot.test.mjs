import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { once } from 'node:events';
import { setEventAssignmentSlotReleased as change, assertReleasedSlotUpdate } from './eventAssignmentSlot.js';
import { serviceTeamCoverage } from '../../src/utils/serviceTeamCoverage.js';
import { serviceDetailMetrics, buildEditableTeamRows, normalizeDailyRoleRequirements, removeEditableTeamRow } from '../../src/utils/serviceDetail.js';
import { releasedTeamSlot } from '../../src/utils/releasedTeamSlot.js';
import { calculateEventTotals } from '../utils/eventTotals.js';
import { buildPendingActions } from '../../src/utils/pendingActions.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { issueSessionToken } from '../security/sessionTokens.js';

const directory = mkdtempSync(join(tmpdir(), 'es-released-slot-'));
process.env.DATABASE_URL = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
process.env.JWT_SECRET = 'isolated-released-slot-test';
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const now = new Date('2026-11-02T12:00:00Z');
let sequence = 0, applicationDb;
before(() => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const sqlite = new DatabaseSync(join(directory, 'test.db')); sqlite.exec(result.stdout); sqlite.close();
});
after(async () => { await db.$disconnect(); await applicationDb?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
const read = (id) => db.event.findUnique({ where: { id }, include: serviceListInclude });
async function fixture({ continuous = false, qty = 38, extraDay = false } = {}) {
  const key = ++sequence;
  await db.collaborator.createMany({ data: Array.from({ length: qty }, (_, i) => ({ name: `Slot ${key}/${i}`, email: `slot-${key}-${i}@example.test` })) });
  const collaborators = await db.collaborator.findMany({ where: { email: { startsWith: `slot-${key}-` } }, orderBy: { id: 'asc' } });
  const event = await db.event.create({ data: { name: 'Slot cancellation regression', date: new Date('2026-11-05'),
    endDate: continuous ? new Date('2026-11-06') : null, isContinuous: continuous, status: 'drafting', statusMode: 'automatic',
    startTime: '10:00', endTime: '16:00', staffVatRateSnapshot: 23, vatRateSnapshot: 23,
    requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty, agreedRate: 12, ...(continuous ? { day: '2026-11-05' } : {}) },
      ...(extraDay ? [{ role: 'Bar', qty: 2, agreedRate: 20, day: '2026-11-06' }] : [])]),
    externalCosts: '[]', clientPaymentRecord: '{"version":1,"entries":[]}',
    assignments: { create: collaborators.map((person, i) => ({ collaboratorId: person.id, role: 'Emp.Mesa',
      assignmentDate: new Date('2026-11-05'), status: i === qty - 1 ? 'cancelled' : 'confirmed', hourlyRate: 8 })) },
  } });
  const loaded = await read(event.id);
  return { event: loaded, row: loaded.assignments.at(-1) };
}
const release = (f, extra = {}) => change(db, f.event.id, f.row.id, { released: true, now, ...extra });

test('38 requested / 37 filled becomes 37/37 without deleting the cancelled collaborator or changing staff history', async () => {
  const f = await fixture();
  const before = f.event.assignments.map(({ updatedAt, slotRelease, ...row }) => row);
  assert.equal(serviceTeamCoverage(f.event).missing, 1);
  const after = await release(f);
  assert.equal(after.assignments.length, 38);
  assert.equal(serviceDetailMetrics(after).requested, 37); assert.equal(serviceDetailMetrics(after).teamFilled, 37);
  assert.equal(serviceTeamCoverage(after).complete, true);
  assert.equal(after.status, 'team_complete');
  assert.ok(releasedTeamSlot(after.assignments.find((row) => row.id === f.row.id)));
  assert.deepEqual(after.assignments.map(({ updatedAt, slotRelease, ...row }) => row), before);
  assert.equal(buildPendingActions({ services: [after] }, { today: now }).some((action) => action.id === `service-team-${after.id}`), false);
  const totals = calculateEventTotals(after);
  for (const field of ['totalRevenue', 'totalCost', 'taxAmount']) assert.equal(Number(after[field]), Number(totals[field]));
  assert.equal(after.externalCosts, f.event.externalCosts); assert.equal(Number(after.staffVatRateSnapshot), 23);
  assert.deepEqual(JSON.parse(after.clientPaymentRecord).entries, []);
});

test('continuous events ignore only the explicitly released row, retaining requirements on other days and roles', async () => {
  const f = await fixture({ continuous: true, extraDay: true });
  const after = await release(f);
  const roles = JSON.parse(after.requiredRoles);
  assert.equal(roles.find((role) => role.day === '2026-11-05').qty, 37);
  assert.equal(roles.find((role) => role.day === '2026-11-06').qty, 2);
  assert.equal(serviceTeamCoverage(after).required, 39, 'Cancelled history must not raise the continuous fallback');
  assert.equal(serviceTeamCoverage(after).missing, 2, 'Other unfilled roles remain unfilled');
});

test('plain cancellation keeps a replacement vacancy; both absence statuses still cover their slots', async () => {
  const f = await fixture({ continuous: true, qty: 3 });
  assert.equal(serviceTeamCoverage(f.event).required, 3); assert.equal(serviceTeamCoverage(f.event).missing, 1);
  for (const status of ['missed_justified', 'missed_unjustified']) {
    await db.eventAssignment.update({ where: { id: f.row.id }, data: { status } });
    const event = await read(f.event.id);
    assert.equal(serviceTeamCoverage(event).complete, true);
    await assert.rejects(release(f), { statusCode: 409 });
  }
});

test('repeated release/restore is idempotent and restores the rate even when the last place removed its role', async () => {
  const f = await fixture({ qty: 1 });
  const after = await release(f);
  assert.equal(JSON.parse(after.requiredRoles).length, 0);
  const repeated = await release(f, { eventUpdatedAt: f.event.updatedAt });
  assert.equal(repeated.requiredRoles, after.requiredRoles);
  const restored = await change(db, f.event.id, f.row.id, { released: false, now });
  assert.equal(JSON.parse(restored.requiredRoles)[0].qty, 1);
  assert.equal(JSON.parse(restored.requiredRoles)[0].agreedRate, 12);
  assert.equal(restored.assignments[0].slotRelease, null); assert.equal(restored.assignments[0].status, 'cancelled');
  assert.equal((await change(db, f.event.id, f.row.id, { released: false })).requiredRoles, restored.requiredRoles);
});

test('new vacancies remain editable and deleting released history cannot reduce the requirement twice', async () => {
  const f = await fixture({ continuous: true, qty: 3 }); const after = await release(f);
  const wire = JSON.parse(JSON.stringify(after));
  const roles = normalizeDailyRoleRequirements(wire);
  const rows = buildEditableTeamRows(wire);
  const historical = rows.find((row) => row.id === f.row.id);
  assert.equal(rows.length, 3);
  assert.deepEqual(removeEditableTeamRow(rows, roles, after, historical.rowKey).requirements, roles);
  const increased = { ...wire, requiredRoles: JSON.stringify(roles.map((role) => ({ ...role, qty: 3 }))) };
  assert.equal(buildEditableTeamRows(increased).filter((row) => !row.collaboratorId).length, 1);
});

test('legacy continuous plans expand civil dates and reduce only the selected day', async () => {
  const f = await fixture({ continuous: true, qty: 3 });
  await db.event.update({ where: { id: f.event.id }, data: { requiredRoles: '[{"role":"Emp.Mesa","qty":3,"agreedRate":12}]' } });
  const event = await release(f), roles = JSON.parse(event.requiredRoles);
  assert.deepEqual(roles.map((role) => [role.day, role.qty]), [['2026-11-05', 2], ['2026-11-06', 3]]);
});

test('wrong event, stale edits, cancelled days, invalid intent and direct marker edits are rejected', async () => {
  const f = await fixture({ continuous: true, qty: 2 }), other = await fixture({ qty: 1 });
  await assert.rejects(change(db, other.event.id, f.row.id, { released: true }), { statusCode: 404 });
  await assert.rejects(release(f, { eventUpdatedAt: '2020-01-01' }), { statusCode: 409 });
  await assert.rejects(change(db, f.event.id, f.row.id, { released: 'true' }), { statusCode: 422 });
  assert.throws(() => assertReleasedSlotUpdate({ slotRelease: null }, f.row), { statusCode: 422 });
  await db.event.update({ where: { id: f.event.id }, data: { cancelledDays: '["2026-11-05"]' } });
  await assert.rejects(release(f), { statusCode: 409 });
  const valid = await release(other);
  const row = valid.assignments[0];
  for (const patch of [{ status: 'confirmed' }, { collaboratorId: 987 }, { role: 'Bar' }, { assignmentDate: '2026-11-06' }]) {
    assert.throws(() => assertReleasedSlotUpdate(patch, row), { statusCode: 409 });
  }
  assert.doesNotThrow(() => assertReleasedSlotUpdate({ status: 'cancelled', paymentNotes: 'Retained' }, row));
});

test('issued financial records are never rewritten to release a slot', async () => {
  const f = await fixture({ qty: 2 });
  await db.event.update({ where: { id: f.event.id }, data: { billingStatus: 'invoiced', totalRevenue: 123.45 } });
  const before = await read(f.event.id);
  await assert.rejects(release(f), { statusCode: 409 });
  assert.deepEqual(await read(f.event.id), before);
});

test('two simultaneous release requests cannot subtract two slots', async () => {
  const f = await fixture({ qty: 3 });
  const results = await Promise.allSettled([release(f), release(f)]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  const after = await read(f.event.id);
  assert.equal(JSON.parse(after.requiredRoles)[0].qty, 2);
  assert.equal(after.assignments.filter(releasedTeamSlot).length, 1);
});

test('marker write failure rolls back the requirement change', async () => {
  const f = await fixture({ qty: 2 }), before = await read(f.event.id);
  const failing = new Proxy(db, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return (callback, options) => target.$transaction((tx) => callback(new Proxy(tx, { get(client, field) {
      if (field === 'eventAssignment') return { ...client.eventAssignment, update: () => { throw new Error('Simulated failure'); } };
      return Reflect.get(client, field);
    } })), options);
  } });
  await assert.rejects(change(failing, f.event.id, f.row.id, { released: true }), /Simulated failure/);
  assert.deepEqual(await read(f.event.id), before);
});

test('migration only adds nullable release metadata without changing historical rows', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE EventAssignment (id INTEGER PRIMARY KEY, status TEXT, checkIn TEXT); INSERT INTO EventAssignment VALUES(1, 'cancelled', '10:00');");
  sqlite.exec(readFileSync('prisma/sqlite/migrations/20261102010000_assignment_slot_release/migration.sql', 'utf8'));
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM EventAssignment').get() }, { id: 1, status: 'cancelled', checkIn: '10:00', slotRelease: null });
  sqlite.close();
});

test('HTTP release requires the existing services-update permission and persists across reload', async () => {
  const { apiRouter } = await import('../routes/index.js');
  applicationDb = (await import('../prisma.js')).prisma;
  const f = await fixture({ qty: 2 });
  const admin = await db.user.create({ data: { email: 'slot-admin@example.test', name: 'Admin', password: 'test-only', role: 'admin' } });
  const profile = await db.accessProfile.create({ data: { key: 'slot-read-only', name: 'Read only', permissions: '["services.view"]' } });
  const denied = await db.user.create({ data: { email: 'slot-denied@example.test', name: 'Denied', password: 'test-only', role: 'operations', accessProfileId: profile.id } });
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/services/${f.event.id}/assignments/${f.row.id}/slot`;
  const send = (user, released) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(user ? { Authorization: `Bearer ${issueSessionToken(user)}` } : {}) }, body: JSON.stringify({ released }) });
  try {
    assert.equal((await send(null, true)).status, 401);
    assert.equal((await send(denied, true)).status, 403);
    assert.equal((await send(admin, true)).status, 200);
    assert.equal(serviceTeamCoverage(await read(f.event.id)).complete, true);
    const response = await fetch(url.replace(/\/assignments\/\d+\/slot$/, ''), {
      headers: { Authorization: `Bearer ${issueSessionToken(denied)}` },
    });
    assert.equal(response.status, 200);
    const publicEvent = await response.json();
    const metadata = JSON.parse(publicEvent.assignments.find((row) => row.id === f.row.id).slotRelease);
    assert.equal(Object.hasOwn(metadata.requirement, 'agreedRate'), false, 'A release snapshot cannot leak rates to read-only operational users');
    assert.equal(serviceTeamCoverage(publicEvent).complete, true, 'Masked metadata still supports the same roster indicator');
    assert.equal((await send(admin, false)).status, 200);
    assert.equal(serviceTeamCoverage(await read(f.event.id)).missing, 1);
  } finally { await new Promise((done) => server.close(done)); }
});
