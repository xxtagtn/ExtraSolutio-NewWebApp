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
import jwt from 'jsonwebtoken';
import { buildBudgetConversionDraft, buildEventPayloadFromBudgetConversion } from '../../src/utils/budgetConversion.js';
import { isArchivedService } from '../../src/utils/serviceStatus.js';
import { isFinanceReadyEvent } from '../../src/utils/financeReadiness.js';
import { calculateEventTotals } from '../utils/eventTotals.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { clientPaymentSummary } from '../../src/utils/clientPayment.js';

const directory = mkdtempSync(join(tmpdir(), 'es-external-workflow-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl;
process.env.JWT_SECRET = 'external-workflow-test-key-never-production';
const { completeExternalService, deriveEventWorkflowStatus, persistInvoiceWithExternalWorkflow, synchronizeEventWorkflow } = await import('./eventWorkflow.js');
const { normalizeEvent } = await import('../routes/crud.js');
const db = new PrismaClient({ datasourceUrl });
const now = new Date('2026-10-13T12:00:00Z');
let sequence = 0;
let client;
before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(migration.stdout);
  sqlite.close();
  client = await db.client.create({ data: { name: 'Cliente QA' } });
});
after(async () => { await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory); });
const costs = JSON.stringify([{ id: 'partner', type: 'Catering', supplier: 'Parceiro QA', costAmount: 1000,
  marginPercent: 20, vatType: 'standard_23', status: 'paid' }]);
const fixture = (patch = {}) => db.event.create({ data: { name: `Parceiro QA ${++sequence}`, clientId: client.id,
  date: new Date('2026-07-30'), status: 'drafting', statusMode: 'automatic', requiredRoles: '[]', assignmentDrafts: null,
  externalCosts: costs, totalCost: 1000, totalRevenue: 1476, taxAmount: 276, vatRateSnapshot: 23,
  billingAdjustment: 12.5, notes: 'Notas a preservar', ...patch } });
const snapshot = (event) => db.event.findUnique({ where: { id: event.id }, include: { assignments: true, invoices: true } });
function withoutWorkflowFields(event) {
  const { status: _status, statusMode: _mode, updatedAt: _updatedAt, ...rest } = event;
  return rest;
}

test('external issued invoice settlement remains authoritative without treating a standalone prepayment as a new received total', async () => {
  const event = await fixture({ billingStatus: 'partial70', signaledAmount: 100, paidAmount: 100 });
  await db.event.update({ where: { id: event.id }, data: clientPaymentRecordPatch(event) });
  const invoice = await db.invoice.create({ data: { number: `ADVANCE-EXTERNAL-${sequence}`, clientId: client.id, eventId: event.id,
    status: 'paid', issueDate: new Date('2026-07-30'), total: 1476 } });
  const result = await synchronizeEventWorkflow(db, event.id, { now });
  assert.equal(result.externalService.settledByInvoice, true);
  assert.equal(clientPaymentSummary(result).received, 1476);
  assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
  const unissued = await fixture({ billingStatus: 'paid', paidAmount: 1476 });
  await db.event.update({ where: { id: unissued.id }, data: clientPaymentRecordPatch(unissued) });
  const saved = await synchronizeEventWorkflow(db, unissued.id, { now });
  assert.equal(saved.externalService.settledByInvoice, false);
  assert.equal(clientPaymentSummary({ ...saved, totalRevenue: 1506 }).received, 1476);
  assert.equal(clientPaymentSummary({ ...saved, totalRevenue: 1506 }).outstanding, 30);
});

test('external services finalize independently of pending/invoiced/received/payment states and preserve every non-operational field', async () => {
  for (const billingStatus of ['pending', 'partial70', 'invoiced', 'paid']) {
    const event = await fixture({ billingStatus, paidAmount: billingStatus === 'paid' ? 1476 : 0,
      signaledAmount: billingStatus === 'partial70' ? 700 : 0,
      billingPaymentDate: billingStatus === 'paid' ? new Date('2026-07-01') : null });
    if (['invoiced', 'paid'].includes(billingStatus)) await db.invoice.create({ data: {
      number: `QA-${sequence}`, clientId: client.id, eventId: event.id, status: billingStatus,
      subtotal: 1200, total: 1476, taxAmount: 276,
    } });
    const before = await snapshot(event);
    const result = await completeExternalService(db, event.id, { now });
    assert.equal(result.status, 'finalized');
    assert.equal(result.statusMode, 'manual');
    assert.deepEqual(withoutWorkflowFields(await snapshot(event)), withoutWorkflowFields(before));
    assert.equal((await synchronizeEventWorkflow(db, event.id, { now })).status, 'finalized');
    assert.deepEqual(await completeExternalService(db, event.id, { now }), result, 'Repeated completion is idempotent');
  }
});

test('paid external services finalize only after their period; advance payments stay active', async () => {
  for (const date of ['2026-07-30', '2030-07-30']) {
    const event = await fixture({ date: new Date(date), billingStatus: 'paid', paidAmount: 1476 });
    const result = await synchronizeEventWorkflow(db, event.id, { now });
    assert.equal(result.status === 'finalized', !date.startsWith('2030'));
    if (date.startsWith('2030')) await assert.rejects(completeExternalService(db, event.id, { now }), { statusCode: 409 });
  }
});

test('normal staff, missing requested staff and mixed staff/partner events cannot use the external completion action', async () => {
  const collaborator = await db.collaborator.create({ data: { name: 'Staff QA', email: 'staff-external-test@example.test' } });
  for (const variant of ['staff', 'missing', 'mixed', 'draft']) {
    const event = await fixture({ externalCosts: variant === 'staff' ? '[]' : costs,
      requiredRoles: variant === 'missing' || variant === 'mixed' ? '[{"role":"Bar","qty":2}]' : '[]',
      assignmentDrafts: variant === 'draft' ? '[{"role":"Emp.Mesa"}]' : null });
    if (variant === 'staff' || variant === 'mixed') await db.eventAssignment.create({ data: {
      eventId: event.id, collaboratorId: collaborator.id, role: 'Bar', status: 'confirmed',
    } });
    const before = await snapshot(event);
    await assert.rejects(completeExternalService(db, event.id, { now }), { statusCode: 409 });
    assert.deepEqual(await snapshot(event), before);
    assert.equal(deriveEventWorkflowStatus(before, now), variant === 'staff' ? 'to_validate_staff' : 'drafting');
  }
});

test('single-day, multi-day and overnight external services respect their last active end without fictitious assignments', async () => {
  const event = await fixture({ date: new Date('2026-08-01'), endDate: new Date('2026-08-05'), isContinuous: true,
    startTime: '18:00', endTime: '04:00' });
  for (const time of ['2026-08-01T22:00:00Z', '2026-08-05T22:00:00Z', '2026-08-06T02:59:00Z']) {
    await assert.rejects(completeExternalService(db, event.id, { now: new Date(time) }), { statusCode: 409 });
  }
  assert.equal((await completeExternalService(db, event.id, { now: new Date('2026-08-06T03:00:00Z') })).status, 'finalized');
  assert.equal(await db.eventAssignment.count({ where: { eventId: event.id } }), 0);
  const cancelled = await fixture({ cancelledDays: '[{"date":"2026-07-30"}]' });
  await assert.rejects(completeExternalService(db, cancelled.id, { now }), { statusCode: 409 });
});

test('30 July external-only adjudicated budget and directly created service both have a safe finalization path', async () => {
  const draft = buildBudgetConversionDraft({ id: 55, reference: 'ORC-QA-30-07', eventType: 'Parceiro', eventDate: '2026-07-30',
    clientId: client.id, categories: '[]', externalCosts: costs, totalAmount: 1476, taxAmount: 276, vatRate: 23 });
  const payload = buildEventPayloadFromBudgetConversion(draft, client.id);
  const normalized = normalizeEvent(payload);
  const converted = await db.event.create({ data: normalized });
  const direct = await fixture();
  for (const event of [converted, direct]) {
    const before = await snapshot(event);
    assert.equal((await completeExternalService(db, event.id, { now })).status, 'finalized');
    assert.deepEqual(withoutWorkflowFields(await snapshot(event)), withoutWorkflowFields(before));
  }
  assert.match((await snapshot(converted)).notes, /BUDGET_REF:ORC-QA-30-07/);
});

test('concurrent configuration changes abort completion instead of writing a stale operational state', async () => {
  const event = await fixture();
  let updates = 0;
  const guarded = { $transaction: async (callback) => callback({ event: {
    findUnique: async () => ({ ...event, assignments: [], invoices: [] }),
    updateMany: async () => { updates += 1; return { count: 0 }; },
  } }) };
  await assert.rejects(completeExternalService(guarded, event.id, { now }), { statusCode: 409 });
  assert.equal(updates, 1);
  assert.equal((await snapshot(event)).status, 'drafting');
});

test('a failure after the operational update rolls the transaction back completely', async () => {
  const event = await fixture();
  const before = await snapshot(event);
  const guarded = { $transaction: (callback) => db.$transaction(async (tx) => {
    let reads = 0;
    return callback({ event: {
      findUnique: (args) => {
        if (++reads > 1) throw new Error('controlled readback failure');
        return tx.event.findUnique(args);
      },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(completeExternalService(guarded, event.id, { now }), /controlled readback failure/);
  assert.deepEqual(await snapshot(event), before);
});

test('real HTTP endpoint enforces authentication, edit permission, eligibility and financial preservation', async () => {
  process.env.DATABASE_URL = datasourceUrl;
  process.env.JWT_SECRET = 'external-workflow-test-key-never-production';
  const { apiRouter } = await import('../routes/index.js');
  const { prisma } = await import('../prisma.js');
  const admin = await db.user.create({ data: { name: 'Admin QA', email: 'external-admin@example.test', password: 'test', role: 'admin' } });
  const viewer = await db.user.create({ data: { name: 'Viewer QA', email: 'external-viewer@example.test', password: 'test',
    role: 'operations', permissionOverrides: '{"deny":["services.update"]}' } });
  const event = await fixture();
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (id, user) => fetch(`${base}/api/services/${id}/workflow/complete-external`, {
    method: 'POST', headers: user ? { Authorization: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` } : {},
  });
  try {
    assert.equal((await send(event.id)).status, 401);
    assert.equal((await send(event.id, viewer)).status, 403);
    const before = await snapshot(event);
    const response = await send(event.id, admin);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'finalized');
    assert.deepEqual(withoutWorkflowFields(await snapshot(event)), withoutWorkflowFields(before));
    const missing = await fixture({ requiredRoles: '[{"role":"Emp.Mesa","qty":4}]' });
    assert.equal((await send(missing.id, admin)).status, 409);
    assert.equal((await send('invalid', admin)).status, 400);
    assert.equal((await send(999999, admin)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});

test('HTTP 30 July budget service: pending -> invoiced -> paid synchronizes both archives without changing money', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  process.env.DATABASE_URL = datasourceUrl;
  const { apiRouter } = await import('../routes/index.js');
  const { prisma } = await import('../prisma.js');
  const admin = await db.user.findUnique({ where: { email: 'external-admin@example.test' } });
  await db.client.update({ where: { id: client.id }, data: { billingMethod: 'per_event', paymentTerm: 'days_15' } });
  const draft = buildBudgetConversionDraft({ id: 55, reference: 'ORC-QA-30-07-LIFECYCLE', eventDate: '2026-07-30',
    clientId: client.id, categories: '[]', externalCosts: costs, totalAmount: 1476, taxAmount: 276, vatRate: 23 });
  const event = await db.event.create({ data: normalizeEvent(buildEventPayloadFromBudgetConversion(draft, client.id)) });
  const before = await snapshot(event);
  const app = express();
  app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
  const get = async (id = event.id) => (await fetch(`${base}/services/${id}`, { headers })).json();
  const put = (path, body) => fetch(`${base}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  try {
    let current = await get();
    assert.equal(isFinanceReadyEvent(current), true);
    assert.equal(isArchivedService(current, now), false);
    let response = await put(`/services/${event.id}`, { billingStatus: 'invoiced' });
    assert.equal(response.status, 200);
    current = await response.json();
    assert.equal(current.billingStatus, 'invoiced'); assert.equal(isArchivedService(current, now), false);
    response = await put(`/services/${event.id}`, { billingStatus: 'paid', billingPaymentDate: '2026-10-13' });
    assert.equal(response.status, 200);
    current = await response.json();
    assert.equal(current.status, 'finalized'); assert.equal(current.billingStatus, 'paid');
    assert.equal(isArchivedService(current, now), true);
    const after = await snapshot(event);
    for (const field of ['externalCosts', 'totalCost', 'totalRevenue', 'taxAmount', 'vatRateSnapshot', 'billingAdjustment', 'notes']) {
      assert.deepEqual(after[field], before[field], field);
    }
    response = await put(`/services/${event.id}`, { billingStatus: 'invoiced', billingPaymentDate: null });
    assert.equal(response.status, 200); assert.equal(isArchivedService(await response.json(), now), false);
    const future = await fixture({ date: new Date('2026-12-20'), endDate: new Date('2026-12-22'), isContinuous: true });
    response = await put(`/services/${future.id}`, { billingStatus: 'paid', billingPaymentDate: '2026-10-13' });
    assert.equal(response.status, 200); assert.equal(isArchivedService(await response.json(), now), false);
    t.mock.timers.setTime(new Date('2026-12-22T23:00:00Z').getTime());
    assert.notEqual((await get(future.id)).status, 'finalized', 'No end time: the last service day must finish in full');
    t.mock.timers.setTime(new Date('2026-12-23T12:00:00Z').getTime());
    current = await get(future.id);
    assert.equal(current.status, 'finalized'); assert.equal(isArchivedService(current, new Date()), true);
    assert.equal((await snapshot(future)).status, 'finalized', 'Read synchronization persists the operational state');
    const editable = await fixture();
    const externalCosts = JSON.stringify([{ type: 'Catering', supplier: 'Parceiro QA', costAmount: 2000,
      marginPercent: 25, vatType: 'standard_23' }]);
    const expected = calculateEventTotals({ ...await snapshot(editable), externalCosts }, []);
    response = await put(`/services/${editable.id}`, { externalCosts });
    assert.equal(response.status, 200);
    current = await response.json();
    for (const field of ['totalCost', 'totalRevenue', 'taxAmount']) {
      assert.equal(Number(current[field]), Number(expected[field]), `Ordinary external edits still recalculate ${field}`);
      assert.equal(Number((await snapshot(editable))[field]), Number(expected[field]));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve)); await prisma.$disconnect();
  }
});

test('invoice paid/cancelled status updates external billing atomically but never finalize mixed/staff events', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  process.env.DATABASE_URL = datasourceUrl;
  const { apiRouter } = await import('../routes/index.js');
  const { prisma } = await import('../prisma.js');
  const admin = await db.user.findUnique({ where: { email: 'external-admin@example.test' } });
  const event = await fixture();
  const mixed = await fixture({ requiredRoles: '[{"role":"Bar","qty":2}]' });
  const invoice = await db.invoice.create({ data: { number: `LIFE-${sequence}`, clientId: client.id,
    eventIds: JSON.stringify([event.id, mixed.id]), status: 'issued', subtotal: 2400, taxAmount: 552, total: 2952 } });
  const money = await snapshot(event);
  const mixedBefore = await snapshot(mixed);
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/invoices/${invoice.id}`;
  const headers = { Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
  try {
    const failing = { $transaction: (callback) => db.$transaction((tx) => callback({
      invoice: tx.invoice,
      event: { findUnique: (args) => tx.event.findUnique(args), updateMany: async () => { throw new Error('controlled synchronization failure'); } },
    })) };
    await assert.rejects(persistInvoiceWithExternalWorkflow(failing, {
      id: invoice.id, data: { status: 'paid' }, existing: invoice,
    }), /controlled synchronization failure/);
    assert.equal((await db.invoice.findUnique({ where: { id: invoice.id } })).status, 'issued');
    assert.deepEqual(await snapshot(event), money, 'Invoice and event must roll back together');
    const paid = await fetch(url, { method: 'PUT', headers, body: '{"status":"paid"}' });
    assert.equal(paid.status, 200);
    assert.equal((await snapshot(event)).status, 'finalized');
    assert.equal((await snapshot(event)).billingStatus, 'paid');
    assert.deepEqual(await snapshot(mixed), { ...mixedBefore, invoices: [] });
    for (const field of ['externalCosts', 'totalCost', 'totalRevenue', 'taxAmount', 'vatRateSnapshot', 'billingAdjustment']) {
      assert.deepEqual((await snapshot(event))[field], money[field]);
    }
    const cancelled = await fetch(url, { method: 'PUT', headers, body: '{"status":"cancelled"}' });
    assert.equal(cancelled.status, 200);
    const current = await snapshot(event);
    assert.equal(current.billingStatus, 'pending'); assert.equal(isArchivedService(current, now), false);
    const savedInvoice = await db.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(Number(savedInvoice.total), 2952); assert.equal(Number(savedInvoice.taxAmount), 552);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await prisma.$disconnect();
  }
});
