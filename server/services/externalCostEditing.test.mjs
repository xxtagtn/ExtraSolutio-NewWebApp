import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { once } from 'node:events';
import { issueSessionToken } from '../security/sessionTokens.js';
import { normalizeExternalCosts } from '../../src/utils/externalCosts.js';
import { calculateEventTotals } from '../utils/eventTotals.js';
import { buildBudgetConversionDraft, buildEventPayloadFromBudgetConversion } from '../../src/utils/budgetConversion.js';

const directory = mkdtempSync(join(tmpdir(), 'es-external-costs-'));
const database = join(directory, 'test.db'), datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl; process.env.JWT_SECRET = 'external-cost-qa-not-production';
const { saveEventExternalCost, deleteEventExternalCost } = await import('./externalCostEditing.js');
const { normalizeEvent } = await import('../routes/crud.js');
const db = new PrismaClient({ datasourceUrl });
let prisma, server, client, headers, base, sequence = 0;
const partner = (patch = {}) => ({ id: 'partner-1', type: 'Catering', supplier: 'Parceiro A', description: 'Servico principal',
  costAmount: 500, marginPercent: 20, vatType: 'standard_23', ...patch });
before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database); sqlite.exec(migration.stdout); sqlite.close();
  const { apiRouter } = await import('../routes/index.js'); ({ prisma } = await import('../prisma.js'));
  const admin = await db.user.create({ data: { email: 'external-cost-admin@example.test', name: 'QA', role: 'admin', password: 'qa' } });
  client = await db.client.create({ data: { name: 'Cliente QA', billingMethod: 'per_event' } });
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/services`;
  headers = { Authorization: `Bearer ${issueSessionToken(admin)}`, 'Content-Type': 'application/json' };
});
after(async () => {
  if (server) await new Promise((done) => server.close(done));
  await prisma?.$disconnect(); await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory);
});
const fixture = (patch = {}) => db.event.create({ data: { name: `Custos QA ${++sequence}`, date: new Date('2026-10-01'),
  status: 'in_progress', statusMode: 'manual', clientId: client.id, requiredRoles: '[]', externalCosts: JSON.stringify(normalizeExternalCosts([partner()])),
  totalCost: 500, totalRevenue: 738, taxAmount: 138, vatRateSnapshot: 23, billingStatus: 'partial70',
  signaledAmount: 100, paidAmount: 100, signaledAt: new Date('2026-09-20'), remainingPaymentDate: new Date('2026-10-10'),
  notes: 'Preservar valores recebidos e equipa', ...patch } });
const read = (id) => db.event.findUnique({ where: { id }, include: { assignments: { include: { collaborator: true } } } });
const request = (event, cost, costId = null, auth = headers) => fetch(`${base}/${event.id}/external-costs${costId ? `/${encodeURIComponent(costId)}` : ''}`, {
  method: costId ? 'PUT' : 'POST', headers: auth, body: JSON.stringify({ cost, updatedAt: event.updatedAt }),
});
function stableFields(event) {
  const { externalCosts: _costs, totalCost: _cost, totalRevenue: _revenue, taxAmount: _tax, realHours: _hours,
    billableHours: _billable, clientPaymentRecord: _record, updatedAt: _updated, ...rest } = event;
  return rest;
}

test('HTTP edits existing cost/margin/tax with existing engine and persists unchanged identity and payment data', async () => {
  const event = await fixture(); const original = await read(event.id);
  const response = await request(event, partner({ costAmount: 600, marginPercent: 25, supplier: 'Parceiro corrigido' }), 'partner-1');
  assert.equal(response.status, 200);
  const result = await response.json(), saved = await read(event.id), rows = JSON.parse(saved.externalCosts);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'partner-1'); assert.equal(rows[0].supplier, 'Parceiro corrigido');
  assert.equal(Number(result.totalCost), 600); assert.equal(Number(result.totalRevenue), 922.5); assert.equal(Number(result.taxAmount), 172.5);
  assert.deepEqual(stableFields(saved), stableFields(original));
  assert.equal(await db.eventAssignment.count({ where: { eventId: event.id } }), 0, 'No fictitious staff is created');
});

test('HTTP adds a second partner exactly once; retry with the same ID never duplicates or changes old costs', async () => {
  const event = await fixture(); const previous = JSON.parse(event.externalCosts);
  const newCost = partner({ id: 'partner-2', supplier: 'Parceiro B', costAmount: 150 });
  let response = await request(event, newCost); assert.equal(response.status, 200);
  let saved = await read(event.id);
  assert.deepEqual(JSON.parse(saved.externalCosts)[0], previous[0]);
  assert.equal(Number(saved.totalCost), 650); assert.equal(Number(saved.totalRevenue), 959.4); assert.equal(Number(saved.taxAmount), 179.4);
  const snapshot = saved;
  response = await request(event, newCost); assert.equal(response.status, 200, 'A lost-response retry is safe despite old updatedAt');
  saved = await read(event.id); assert.deepEqual(saved, snapshot);
  assert.equal(JSON.parse(saved.externalCosts).length, 2);
  response = await request(event, partner({ id: 'partner-3' })); assert.equal(response.status, 409);
  assert.deepEqual(await read(event.id), snapshot);
});

test('HTTP adds the first partner to single-day and continuous events without inventing staff or changing dates', async () => {
  for (const isContinuous of [false, true]) {
    const event = await fixture({ externalCosts: '[]', totalCost: 0, totalRevenue: 0, taxAmount: 0,
      isContinuous, endDate: isContinuous ? new Date('2026-10-05') : null });
    const before = await read(event.id);
    const response = await request(event, partner({ id: 'first-partner' }));
    assert.equal(response.status, 200);
    const saved = await read(event.id);
    assert.equal(Number(saved.totalCost), 500); assert.equal(Number(saved.totalRevenue), 738);
    assert.deepEqual(stableFields(saved), stableFields(before)); assert.equal(saved.assignments.length, 0);
  }
});

test('HTTP multiple partners with exempt/Catering VAT retain untouched rows when one cost changes', async () => {
  const costs = normalizeExternalCosts([partner(), partner({ id: 'partner-2', supplier: 'B', costAmount: 100, vatType: 'exempt' }),
    partner({ id: 'partner-3', supplier: 'C', costAmount: 150, vatType: 'catering' })]);
  const event = await fixture({ externalCosts: JSON.stringify(costs) });
  const response = await request(event, partner({ id: 'partner-3', supplier: 'C', costAmount: 200, vatType: 'catering' }), 'partner-3');
  assert.equal(response.status, 200);
  const saved = await read(event.id), rows = JSON.parse(saved.externalCosts);
  assert.deepEqual(rows[0], costs[0]); assert.deepEqual(rows[1], costs[1]);
  const expected = calculateEventTotals({ ...saved, externalCosts: rows }, saved.assignments);
  for (const field of ['totalCost', 'totalRevenue', 'taxAmount']) assert.equal(Number(saved[field]), expected[field]);
});

test('HTTP mixed staff/partner cost changes do not modify staff pay, hours, advances or actual customer receipts', async () => {
  const event = await fixture({ requiredRoles: '[{"role":"Bar","qty":1,"agreedRate":20}]' });
  const collaborator = await db.collaborator.create({ data: { name: 'Staff QA', email: 'external-cost-staff@example.test' } });
  const assignment = await db.eventAssignment.create({ data: { eventId: event.id, collaboratorId: collaborator.id, role: 'Bar', status: 'confirmed',
    hourlyRate: 10, checkIn: '10:00', checkOut: '12:00', clientCheckIn: '10:00', clientCheckOut: '12:00', validationStatus: 'validated',
    paymentStatus: 'paid', paymentDate: new Date('2026-10-01'), paymentAdjustment: 2, advancePayments: '[{"amount":3,"note":"Adiantamento"}]' } });
  const before = await read(event.id);
  const response = await request(before, partner({ id: 'mixed-add', costAmount: 150 })); assert.equal(response.status, 200);
  const saved = await read(event.id);
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: assignment.id } }), assignment);
  const expected = calculateEventTotals(saved, saved.assignments);
  for (const field of ['totalCost', 'totalRevenue', 'taxAmount']) assert.equal(Number(saved[field]), expected[field]);
  for (const field of ['paidAmount', 'signaledAmount', 'signaledAt', 'remainingPaymentDate', 'billingStatus', 'notes', 'requiredRoles']) {
    assert.deepEqual(saved[field], before[field]);
  }
});

test('HTTP budget-derived event retains conversion reference and uses the same external totals', async () => {
  const draft = buildBudgetConversionDraft({ id: 91, reference: 'ORC-EXT-QA', clientId: client.id, eventDate: '2026-10-01',
    categories: '[]', externalCosts: JSON.stringify([partner()]), totalAmount: 738, taxAmount: 138, vatRate: 23 });
  const data = normalizeEvent(buildEventPayloadFromBudgetConversion(draft, client.id));
  const event = await db.event.create({ data });
  const response = await request(event, partner({ id: 'budget-add', costAmount: 150 })); assert.equal(response.status, 200);
  const saved = await read(event.id);
  assert.match(saved.notes, /BUDGET_REF:ORC-EXT-QA/); assert.equal(Number(saved.totalRevenue), 959.4);
  assert.equal(saved.assignments.length, 0);
});

test('HTTP incomplete staff prices never leave changed external costs beside a protected stale snapshot', async () => {
  for (const missing of ['client', 'staff']) {
    const event = await fixture({ requiredRoles: JSON.stringify([{ role: 'Bar', qty: 1, agreedRate: missing === 'client' ? 0 : 20 }]),
      totalRevenue: 900, totalCost: 550 });
    const collaborator = await db.collaborator.create({ data: { name: 'Incomplete QA', email: `missing-${missing}@example.test` } });
    await db.eventAssignment.create({ data: { eventId: event.id, collaboratorId: collaborator.id, role: 'Bar', status: 'confirmed',
      hourlyRate: missing === 'staff' ? 0 : 10, checkIn: '10:00', checkOut: '12:00' } });
    const before = await read(event.id);
    const response = await request(event, partner({ id: 'incomplete-add', costAmount: 150 }));
    assert.equal(response.status, 409); assert.match((await response.json()).message, /preços de Staff incompletos/);
    assert.deepEqual(await read(event.id), before);
  }
});

test('HTTP invoice protections, grouped invoice links and permissions cannot be bypassed', async () => {
  for (const billingStatus of ['invoiced']) {
    const event = await fixture({ billingStatus }), original = await read(event.id);
    assert.equal((await request(event, partner({ id: 'blocked' }))).status, 409);
    assert.deepEqual(await read(event.id), original);
  }
  for (const grouped of [false, true]) {
    const event = await fixture(), original = await read(event.id);
    const invoice = await db.invoice.create({ data: { number: `EXT-LOCK-${sequence}`, clientId: client.id, status: 'issued',
      issueDate: new Date('2026-10-01'), total: 738, ...(grouped ? { eventIds: JSON.stringify([event.id]) } : { eventId: event.id }) } });
    assert.equal((await request(event, partner({ costAmount: 999 }), 'partner-1')).status, 409);
    assert.deepEqual(await read(event.id), original);
    assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
  }
  const event = await fixture();
  assert.equal((await request(event, partner({ id: 'no-auth' }), null, { 'Content-Type': 'application/json' })).status, 401);
  const viewer = await db.user.create({ data: { email: 'external-cost-viewer@example.test', name: 'QA reader', role: 'operations', password: 'qa',
    permissionOverrides: '{"deny":["services.update"]}' } });
  assert.equal((await request(event, partner({ id: 'no-permission' }), null,
    { ...headers, Authorization: `Bearer ${issueSessionToken(viewer)}` })).status, 403);
});

test('HTTP validation, stale versions, duplicate IDs and cross-event IDs do not change existing records', async () => {
  const event = await fixture(), original = await read(event.id);
  for (const patch of [{ costAmount: -1 }, { type: '' }, { supplier: '', description: '' }, { vatType: 'invalid' },
    { costAmount: 9999999999, marginPercent: 100 }]) {
    assert.equal((await request(event, partner({ id: 'invalid', ...patch }))).status, 422);
    assert.deepEqual(await read(event.id), original);
  }
  assert.equal((await request({ ...event, updatedAt: '2000-01-01' }, partner({ id: 'stale' }))).status, 409);
  assert.equal((await request(event, partner({ id: 'foreign-id' }), 'foreign-id')).status, 404);
  assert.deepEqual(await read(event.id), original);
});

test('external cost and total updates roll back together on failures or conditional conflicts', async () => {
  const event = await fixture(), original = await read(event.id);
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('controlled external-cost readback failure'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(saveEventExternalCost(failing, event.id, { cost: partner({ id: 'rollback' }), updatedAt: event.updatedAt }), /controlled external-cost readback failure/);
  assert.deepEqual(await read(event.id), original);
  const conflict = { $transaction: (callback) => db.$transaction((tx) => callback({ invoice: tx.invoice,
    event: { findUnique: (args) => tx.event.findUnique(args), updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(saveEventExternalCost(conflict, event.id, { cost: partner({ id: 'conflict' }), updatedAt: event.updatedAt }), { statusCode: 409 });
  assert.deepEqual(await read(event.id), original);
});

const removeRequest = (event, costId = 'partner-1', auth = headers) => fetch(`${base}/${event.id}/external-costs/${costId}`, {
  method: 'DELETE', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt }),
});

test('HTTP deleting one of several partners recalculates once and preserves other rows, receipts and state', async () => {
  const costs = normalizeExternalCosts([partner(), partner({ id: 'partner-2', costAmount: 150, vatType: 'exempt' })]);
  const event = await fixture({ externalCosts: JSON.stringify(costs), totalRevenue: 918, totalCost: 650 });
  const before = await read(event.id);
  const result = await removeRequest(event, 'partner-2'); assert.equal(result.status, 200);
  const saved = await read(event.id);
  assert.deepEqual(JSON.parse(saved.externalCosts), [costs[0]]);
  assert.equal(Number(saved.totalRevenue), 738); assert.equal(Number(saved.taxAmount), 138); assert.equal(Number(saved.totalCost), 500);
  assert.deepEqual(stableFields(saved), stableFields(before));
  assert.equal((await removeRequest(saved, 'partner-2')).status, 404);
  assert.deepEqual(await read(event.id), saved);
});

test('HTTP deleting the final known partner, including budget events and multiple days, leaves no orphaned totals', async () => {
  for (const budget of [false, true]) {
    const event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0,
      isContinuous: budget, endDate: budget ? new Date('2026-10-05') : null, notes: budget ? '[BUDGET_REF:DELETE-QA]' : 'Direct event' });
    const result = await removeRequest(event); assert.equal(result.status, 200);
    const saved = await read(event.id);
    assert.equal(saved.externalCosts, '[]'); assert.equal(Number(saved.totalRevenue), 0);
    assert.equal(Number(saved.totalCost), 0); assert.equal(Number(saved.taxAmount), 0);
    assert.equal(saved.assignments.length, 0); assert.equal(saved.status, event.status); assert.equal(saved.notes, event.notes);
  }
});

test('HTTP deletion rejects stale, missing, invalid-ID and unauthorized requests without changes', async () => {
  const event = await fixture(), before = await read(event.id);
  assert.equal((await removeRequest({ ...event, updatedAt: '2000-01-01' })).status, 409);
  assert.equal((await removeRequest(event, 'foreign')).status, 404);
  assert.equal((await removeRequest(event, 'partner-1', { 'Content-Type': 'application/json' })).status, 401);
  const viewer = await db.user.create({ data: { email: 'cost-delete-viewer@example.test', name: 'Reader', password: 'qa', role: 'operations',
    permissionOverrides: '{"deny":["services.update"]}' } });
  assert.equal((await removeRequest(event, 'partner-1', { ...headers,
    Authorization: `Bearer ${issueSessionToken(viewer)}` })).status, 403);
  assert.deepEqual(await read(event.id), before);
});

test('HTTP final partner deletion never erases unexplained budget snapshots or prior customer receipts', async () => {
  for (const patch of [{ notes: '[BUDGET_REF:UNEXPLAINED]', totalRevenue: 900 }, {}]) {
    const event = await fixture(patch), before = await read(event.id);
    assert.equal((await removeRequest(event)).status, 409);
    assert.deepEqual(await read(event.id), before);
  }
});

test('deletion readback failure rolls back cost removal and every financial field together', async () => {
  const event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0 }), before = await read(event.id);
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('delete rollback'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(deleteEventExternalCost(failing, event.id, { costId: 'partner-1', updatedAt: event.updatedAt }), /delete rollback/);
  assert.deepEqual(await read(event.id), before);
});
