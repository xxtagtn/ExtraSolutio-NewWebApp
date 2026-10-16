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
import { clientPaymentDraft, clientPaymentSummary, buildClientPaymentPayload } from '../../src/utils/clientPayment.js';
import { receiveAdditionalClientPayment, reverseClientReceipts, reverseClientSignal } from './clientPayment.js';

const directory = mkdtempSync(join(tmpdir(), 'es-client-payment-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl;
process.env.JWT_SECRET = 'client-payment-qa-not-production';
const db = new PrismaClient({ datasourceUrl });
let server, prisma, headers, base, client, sequence = 0;

before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database); sqlite.exec(migration.stdout); sqlite.close();
  const { apiRouter } = await import('../routes/index.js');
  ({ prisma } = await import('../prisma.js'));
  const admin = await db.user.create({ data: { email: 'client-payment-qa@example.test', name: 'QA', role: 'admin', password: 'test' } });
  client = await db.client.create({ data: { name: 'Cliente QA' } });
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
const fixture = (patch = {}) => db.event.create({ data: { name: `Pagamento QA ${++sequence}`, date: new Date('2026-10-09'),
  status: 'finalized', statusMode: 'manual', clientId: client.id, requiredRoles: '[{"role":"Bar","qty":1,"agreedRate":10}]',
  totalRevenue: 252, totalCost: 100, taxAmount: 47.12, vatRateSnapshot: 23, externalCosts: '[]', billingStatus: 'partial70',
  signaledAmount: 157.5, paidAmount: 157.5, signaledAt: new Date('2026-10-09'), remainingPaymentDate: new Date('2026-10-14'),
  notes: 'Preservar financeiro e operacao', ...patch } });
const get = async (id) => (await fetch(`${base}/${id}`, { headers })).json();
const put = (id, data) => fetch(`${base}/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) });
const stored = (id) => db.event.findUnique({ where: { id } });
const reverse = (event, auth = headers) => fetch(`${base}/${event.id}/client-payment/reverse-signal`, {
  method: 'POST', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt }),
});
function invariant(event) {
  const { billingStatus: _status, signaledAmount: _signal, signaledAt: _signalDate, remainingPaymentDate: _due,
    paidAmount: _paid, billingPaymentDate: _paidDate, clientPaymentRecord: _record, updatedAt: _updated, ...rest } = event;
  return rest;
}

test('HTTP partial -> settled -> reopen retains two receipts, dates, total and service rules', async () => {
  const event = await fixture();
  const original = await stored(event.id);
  const initial = await get(event.id);
  assert.equal(clientPaymentSummary(initial).outstanding, 94.5);
  let response = await put(event.id, buildClientPaymentPayload(clientPaymentDraft(initial), initial));
  assert.equal(response.status, 200);
  assert.equal(clientPaymentSummary(await get(event.id)).outstanding, 94.5);
  const paid = buildClientPaymentPayload({ ...clientPaymentDraft(initial), billingStatus: 'paid', remainingReceived: '94,50', billingPaymentDate: '2026-10-14' }, initial);
  response = await put(event.id, paid); assert.equal(response.status, 200);
  const reread = await get(event.id);
  assert.equal(reread.billingStatus, 'paid');
  assert.equal(clientPaymentSummary(reread).outstanding, 0);
  assert.equal(clientPaymentSummary(reread).remainingReceived, 94.5);
  assert.equal(Number(reread.signaledAmount), 157.5);
  assert.equal(reread.signaledAt.slice(0, 10), '2026-10-09');
  assert.equal(reread.remainingPaymentDate.slice(0, 10), '2026-10-14');
  assert.equal(reread.billingPaymentDate.slice(0, 10), '2026-10-14');
  response = await put(event.id, paid); assert.equal(response.status, 200);
  assert.equal(Number((await stored(event.id)).paidAmount), 252, 'Repeated save never adds the receipt again');
  assert.deepEqual(invariant(await stored(event.id)), invariant(original));
});

test('HTTP rejects underpaid/overpaid/missing date receipts atomically; planned dates alone stay pending', async () => {
  const event = await fixture(); const original = await stored(event.id);
  const valid = buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'paid', remainingReceived: 94.5, billingPaymentDate: '2026-10-14' }, event);
  for (const patch of [{ paidAmount: 200 }, { paidAmount: 253 }, { billingPaymentDate: null }, { billingPaymentDate: '2026-10-08' }]) {
    const response = await put(event.id, { ...valid, ...patch });
    assert.equal(response.status, 422, JSON.stringify(patch));
    assert.deepEqual(await stored(event.id), original);
  }
  const response = await put(event.id, { ...buildClientPaymentPayload(clientPaymentDraft(event), event), remainingPaymentDate: '2020-01-01' });
  assert.equal(response.status, 200);
  assert.equal((await get(event.id)).billingStatus, 'partial70');
  assert.equal(clientPaymentSummary(await get(event.id)).outstanding, 94.5);
});

test('HTTP legacy paid query does not rewrite unknown dates or stored receipt amounts', async () => {
  for (const paidAmount of [0, 157.5]) {
    const event = await fixture({ billingStatus: 'paid', paidAmount, billingPaymentDate: null });
    const original = await stored(event.id);
    const current = await get(event.id);
    assert.equal(clientPaymentSummary(current).outstanding, 0);
    assert.equal(clientPaymentSummary(current).remainingReceived, 94.5);
    assert.equal(current.billingPaymentDate, null);
    assert.deepEqual(await stored(event.id), original);
  }
});

test('HTTP existing Finance paid selector records the total once while preserving initial receipt and due date', async () => {
  const event = await fixture();
  const response = await put(event.id, { billingStatus: 'paid', billingPaymentDate: '2026-10-14' });
  assert.equal(response.status, 200);
  const current = await get(event.id);
  assert.equal(Number(current.paidAmount), 252);
  assert.equal(Number(current.signaledAmount), 157.5);
  assert.equal(current.signaledAt.slice(0, 10), '2026-10-09');
  assert.equal(current.remainingPaymentDate.slice(0, 10), '2026-10-14');
  assert.equal(clientPaymentSummary(current).outstanding, 0);
});

test('HTTP external settlement still archives after the service period without recalculating money', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T12:00:00Z') });
  const event = await fixture({ requiredRoles: '[]', status: 'in_progress', statusMode: 'automatic',
    externalCosts: '[{"costAmount":200,"marginPercent":26}]', totalCost: 200, taxAmount: 0 });
  const original = await stored(event.id);
  const payment = buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'paid', remainingReceived: 94.5, billingPaymentDate: '2026-10-14' }, event);
  const response = await put(event.id, payment); assert.equal(response.status, 200);
  const current = await get(event.id); assert.equal(current.status, 'finalized'); assert.equal(current.externalService.settled, true);
  for (const field of ['totalRevenue', 'totalCost', 'taxAmount', 'externalCosts', 'notes']) {
    assert.deepEqual((await stored(event.id))[field], original[field]);
  }
});

test('HTTP Costs corrects signal amount/dates, then reverses it without changing totals, tax or service data', async () => {
  const event = await fixture({ signaledAmount: 175.5, paidAmount: 175.5 });
  const original = await stored(event.id);
  const corrected = buildClientPaymentPayload({ ...clientPaymentDraft(event), signaledAmount: '157,50',
    signaledAt: '2026-10-10', remainingPaymentDate: '2026-10-20' }, event);
  let response = await put(event.id, corrected); assert.equal(response.status, 200);
  let current = await stored(event.id);
  assert.equal(Number(current.paidAmount), 157.5); assert.equal(clientPaymentSummary(current).outstanding, 94.5);
  assert.equal(current.signaledAt.toISOString().slice(0, 10), '2026-10-10');
  assert.equal(current.remainingPaymentDate.toISOString().slice(0, 10), '2026-10-20');
  response = await reverse(current); assert.equal(response.status, 200);
  current = await stored(event.id);
  assert.equal(current.billingStatus, 'pending'); assert.equal(Number(current.signaledAmount), 0);
  assert.equal(Number(current.paidAmount), 0); assert.equal(current.signaledAt, null);
  assert.equal(clientPaymentSummary(current).outstanding, 252);
  assert.equal(current.remainingPaymentDate.toISOString().slice(0, 10), '2026-10-20', 'Keep the existing forecast instead of deleting unrelated data');
  assert.deepEqual(invariant(current), invariant(original));
});

test('HTTP reversal blocks later receipts and settled payments, including direct/grouped paid invoices', async () => {
  for (const patch of [{ billingStatus: 'paid', paidAmount: 252 }, { billingStatus: 'paid', paidAmount: 0 },
    { paidAmount: 200 }, { paidAmount: 100 }, { billingPaymentDate: new Date('2026-10-14') }]) {
    const event = await fixture(patch); const original = await stored(event.id);
    assert.equal((await reverse(event)).status, 422);
    assert.deepEqual(await stored(event.id), original);
  }
  for (const grouped of [false, true]) {
    const event = await fixture();
    const invoice = await db.invoice.create({ data: { number: `REV-PAID-${sequence}`, clientId: client.id, total: 252,
      status: 'paid', issueDate: new Date('2026-10-14'), ...(grouped ? { eventIds: JSON.stringify([event.id]) } : { eventId: event.id }) } });
    const original = await stored(event.id);
    assert.equal((await reverse(event)).status, 422);
    assert.deepEqual(await stored(event.id), original);
    assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
    assert.equal((await put(event.id, { signaledAmount: 0, paidAmount: 0 })).status, 422, 'Generic PUT cannot bypass the protection');
  }
});

test('HTTP reversal keeps an open invoice and restores invoiced, with exact grouped IDs', async () => {
  const event = await fixture();
  const invoice = await db.invoice.create({ data: { number: `REV-OPEN-${sequence}`, clientId: client.id,
    eventIds: JSON.stringify([event.id]), status: 'issued', issueDate: new Date('2026-10-09'), total: 252 } });
  assert.equal((await reverse(event)).status, 200);
  assert.equal((await stored(event.id)).billingStatus, 'invoiced');
  assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
  const other = await fixture();
  await db.invoice.create({ data: { number: `REV-OTHER-${sequence}`, clientId: client.id,
    eventIds: JSON.stringify([Number(`${other.id}0`)]), status: 'paid', issueDate: new Date('2026-10-09'), total: 252 } });
  assert.equal((await reverse(other)).status, 200, 'Substring match alone must not associate an invoice');
  assert.equal((await stored(other.id)).billingStatus, 'pending');
});

test('HTTP reversal enforces permission and stale-view protection without touching existing data', async () => {
  const event = await fixture(); const original = await stored(event.id);
  assert.equal((await reverse(event, { 'Content-Type': 'application/json' })).status, 401);
  const viewer = await db.user.create({ data: { name: 'Viewer QA', email: 'signal-viewer@example.test', password: 'qa', role: 'operations',
    permissionOverrides: '{"deny":["services.update"]}' } });
  const viewerHeaders = { ...headers, Authorization: `Bearer ${issueSessionToken(viewer)}` };
  assert.equal((await reverse(event, viewerHeaders)).status, 403);
  assert.equal((await reverse({ ...event, updatedAt: '2000-01-01T00:00:00Z' })).status, 409);
  assert.deepEqual(await stored(event.id), original);
});

test('signal reversal rolls back after readback failure and rejects a concurrent update', async () => {
  const event = await fixture(); const original = await stored(event.id);
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('controlled reversal readback failure'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(reverseClientSignal(failing, event.id), /controlled reversal readback failure/);
  assert.deepEqual(await stored(event.id), original);
  const conflict = { $transaction: (callback) => db.$transaction((tx) => callback({ invoice: tx.invoice,
    event: { findUnique: (args) => tx.event.findUnique(args), updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(reverseClientSignal(conflict, event.id), { statusCode: 409 });
  assert.deepEqual(await stored(event.id), original);
});

const reverseReceipts = (event, patch = {}, auth = headers) => fetch(`${base}/${event.id}/client-payment/reverse-receipts`, {
  method: 'POST', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt,
    confirmedReceived: clientPaymentSummary(event).received, confirmedSignal: clientPaymentSummary(event).signal, ...patch }),
});

test('HTTP explicit receipt correction reverses the Rita simulation and preserves costs, VAT, dates forecast and operation', async () => {
  const event = await fixture({ name: 'Particular - Rita Antunes QA', billingStatus: 'pending', totalRevenue: 1252.14,
    signaledAmount: 816.23, paidAmount: 1166.04, signaledAt: null, billingPaymentDate: new Date('2026-07-27') });
  const original = await stored(event.id);
  assert.equal((await reverse(event)).status, 422);
  assert.equal((await reverseReceipts(event)).status, 200);
  const current = await stored(event.id);
  assert.equal(Number(current.paidAmount), 0); assert.equal(Number(current.signaledAmount), 0);
  assert.equal(current.billingStatus, 'pending'); assert.equal(current.billingPaymentDate, null); assert.equal(current.signaledAt, null);
  assert.equal(clientPaymentSummary(current).outstanding, 1252.14);
  assert.deepEqual(invariant(current), invariant(original));
  assert.deepEqual(current.remainingPaymentDate, original.remainingPaymentDate);
  assert.equal((await reverseReceipts(event)).status, 409, 'repeated request with stale revision must not apply again');
  assert.deepEqual(await stored(event.id), current);
});

test('HTTP receipt correction requires current amounts, version, financial permission and no issued direct/grouped invoice', async () => {
  const event = await fixture({ paidAmount: 200, billingPaymentDate: new Date('2026-10-14') });
  const original = await stored(event.id);
  for (const patch of [{ updatedAt: null }, { confirmedReceived: 0 }, { confirmedSignal: 0 },
    { updatedAt: '2000-01-01T00:00:00Z' }]) {
    assert.ok([409, 422].includes((await reverseReceipts(event, patch)).status));
    assert.deepEqual(await stored(event.id), original);
  }
  assert.equal((await reverseReceipts(event, {}, { 'Content-Type': 'application/json' })).status, 401);
  const operator = await db.user.create({ data: { name: 'Operation QA', email: 'receipts-operator@example.test', password: 'qa', role: 'operations',
    permissionOverrides: '{"deny":["finance.updatePayments"]}' } });
  const limited = { ...headers, Authorization: `Bearer ${issueSessionToken(operator)}` };
  assert.equal((await reverseReceipts(event, {}, limited)).status, 403);
  for (const grouped of [false, true]) {
    const issuedEvent = await fixture({ billingStatus: 'paid', paidAmount: 252 });
    const invoice = await db.invoice.create({ data: { number: `RECEIPT-LOCK-${sequence}`, clientId: client.id, total: 252,
      status: 'issued', issueDate: new Date('2026-10-14'), ...(grouped ? { eventIds: JSON.stringify([issuedEvent.id]) } : { eventId: issuedEvent.id }) } });
    const before = await stored(issuedEvent.id);
    assert.equal((await reverseReceipts(issuedEvent)).status, 422);
    assert.deepEqual(await stored(issuedEvent.id), before);
    assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
  }
  assert.deepEqual(await stored(event.id), original);
});

test('explicit receipt correction rolls back on readback failure and rejects concurrent writes', async () => {
  const event = await fixture({ paidAmount: 200 }); const original = await stored(event.id);
  const options = { updatedAt: event.updatedAt, confirmedReceived: 200, confirmedSignal: 157.5 };
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('controlled receipt readback failure'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(reverseClientReceipts(failing, event.id, options), /controlled receipt readback failure/);
  assert.deepEqual(await stored(event.id), original);
  const conflict = { $transaction: (callback) => db.$transaction((tx) => callback({ invoice: tx.invoice,
    event: { findUnique: (args) => tx.event.findUnique(args), updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(reverseClientReceipts(conflict, event.id, options), { statusCode: 409 });
  assert.deepEqual(await stored(event.id), original);
});

test('legacy invoiced settlement keeps financial closure even after billingStatus changes to paid', async () => {
  const event = await fixture({ billingStatus: 'invoiced' });
  assert.equal((await put(event.id, { billingStatus: 'paid', billingPaymentDate: '2026-10-14' })).status, 200);
  const current = await stored(event.id);
  assert.equal(JSON.parse(current.clientPaymentRecord).legacyInvoiced, true);
  assert.equal((await put(event.id, { requiredRoles: [{ role: 'Bar', qty: 1, agreedRate: 20 }] })).status, 409);
  assert.deepEqual(await stored(event.id), current);
});

test('additional receipt rejects invalid values, stale data and unauthorized users without altering previous receipts', async () => {
  const event = await fixture({ billingStatus: 'paid', totalRevenue: 282, paidAmount: 252, billingPaymentDate: new Date('2026-10-14') });
  const before = await stored(event.id);
  const send = (patch = {}, auth = headers) => fetch(`${base}/${event.id}/client-payment/receive-additional`, {
    method: 'POST', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt, amount: 30, receivedAt: '2026-10-16', ...patch }),
  });
  for (const patch of [{ amount: 0 }, { amount: 31 }, { amount: -1 }, { receivedAt: '' }, { receivedAt: '2026-10-01' }, { updatedAt: null }]) {
    assert.equal((await send(patch)).status, 422); assert.deepEqual(await stored(event.id), before);
  }
  assert.equal((await send({ updatedAt: '2000-01-01' })).status, 409);
  assert.equal((await send({}, { 'Content-Type': 'application/json' })).status, 401);
  const operator = await db.user.findUnique({ where: { email: 'receipts-operator@example.test' } });
  const limited = { ...headers, Authorization: `Bearer ${issueSessionToken(operator)}` };
  assert.equal((await send({}, limited)).status, 403); assert.deepEqual(await stored(event.id), before);
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('additional rollback'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(receiveAdditionalClientPayment(failing, event.id, { updatedAt: event.updatedAt, amount: 30, receivedAt: '2026-10-16' }), /additional rollback/);
  assert.deepEqual(await stored(event.id), before);
});
