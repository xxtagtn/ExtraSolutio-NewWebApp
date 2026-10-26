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
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { receiptMovements } from '../../src/utils/clientReceiptMovements.js';
import { clientReceiptTaxSummary } from '../../src/utils/clientReceiptTax.js';
import { normalizeExternalCosts } from '../../src/utils/externalCosts.js';
import { changeClientReceipt } from './clientReceiptMovements.js';
import { clientFinancialState } from '../../src/utils/clientFinancialState.js';
import { eventRevenueIsLocked } from '../utils/eventInvoiceProtection.js';
import { splitClientBillingRows } from '../../src/utils/clientBilling.js';
import { updateClientFinancialMetadata } from './clientFinancialMetadata.js';
import { settleClientInvoice } from './clientInvoiceSettlement.js';

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

const financeRequest = (event, action, body = {}, auth = headers) => fetch(`${base}/${event.id}/client-payment/${action}`, {
  method: 'POST', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt,
    ...(action === 'commercial-status' && body.status === 'invoiced' ? { issueDate: '2026-10-15' } : {}),
    revision: action === 'commercial-status' ? readClientPaymentRecord(event.clientPaymentRecord)?.commercialChanges?.length || 0
      : readClientPaymentRecord(event.clientPaymentRecord)?.entries.length || 0, ...body }),
});
const metadataRequest = (event, body, auth = headers) => fetch(`${base}/${event.id}/client-finance`, {
  method: 'POST', headers: auth, body: JSON.stringify({ updatedAt: event.updatedAt,
    revision: readClientPaymentRecord(event.clientPaymentRecord)?.entries.length || 0, ...body }),
});

const invoicePaidRequest = (event, body = {}, auth = headers) => financeRequest(event, 'invoice-paid', {
  amount: clientFinancialState(event).outstanding, confirmedTotal: clientFinancialState(event).total,
  confirmedReceived: clientFinancialState(event).received, receivedAt: '2026-10-16', ...body,
}, auth);

test('Fatura paga records only the remainder and archives atomically, retaining signal, VAT and operations', async () => {
  let event = await fixture({ billingStatus: 'invoiced' });
  const before = await stored(event.id);
  const response = await invoicePaidRequest(event);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  event = await stored(event.id);
  assert.equal(Number(event.paidAmount), 252);
  const rows = receiptMovements(event.clientPaymentRecord).rows;
  assert.deepEqual(rows.map((row) => [row.type, row.amount]), [['signal', 157.5], ['remaining', 94.5]]);
  assert.equal(rows[1].receivedAt, '2026-10-16');
  assert.equal(result.clientFinance.archive.archived, true);
  assert.deepEqual(invariant(event), invariant(before));
  assert.equal((await invoicePaidRequest(before)).status, 409, 'Double/stale submission cannot add another receipt');
  assert.equal(receiptMovements((await stored(event.id)).clientPaymentRecord).rows.length, 2);
});

test('Fatura paga archives an already received service without inventing a new receipt or replacing its date', async () => {
  let event = await fixture({ billingStatus: 'paid', paidAmount: 252, billingPaymentDate: new Date('2026-10-14') });
  event = await db.event.update({ where: { id: event.id }, data: clientPaymentRecordPatch(event) });
  const previous = readClientPaymentRecord(event.clientPaymentRecord).entries;
  const response = await invoicePaidRequest(event);
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await stored(event.id);
  assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord).entries, previous);
  assert.equal(saved.billingPaymentDate.toISOString().slice(0, 10), '2026-10-14');
  assert.equal((await response.json()).clientFinance.archive.archived, true);
});

test('Fatura paga preserves unfinished Staff operations and cannot archive future services', async () => {
  const event = await fixture({ date: new Date('2099-10-09'), status: 'in_progress', billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const response = await invoicePaidRequest(event);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.status, 'in_progress');
  assert.equal(result.clientFinance.payment.outstanding, 0);
  assert.equal(result.clientFinance.archive.archived, false);
  assert.equal(result.clientFinance.archive.canArchive, false);
});

test('Fatura paga updates an associated full invoice and keeps actual receipts independent of invoice status', async () => {
  const event = await fixture({ billingStatus: 'invoiced' });
  const invoice = await db.invoice.create({ data: { number: `SETTLE-${event.id}`, clientId: client.id, eventId: event.id,
    issueDate: new Date('2026-10-10'), status: 'issued', subtotal: 204.88, taxAmount: 47.12, total: 252 } });
  const loaded = await get(event.id);
  const response = await invoicePaidRequest(loaded);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await db.invoice.findUnique({ where: { id: invoice.id } })).status, 'paid');
  assert.equal((await response.json()).clientFinance.archive.archived, true);
  assert.equal(receiptMovements((await stored(event.id)).clientPaymentRecord).rows.at(-1).amount, 94.5);
});

test('a paid partial invoice never settles or archives the entire event and mismatched invoices roll back', async () => {
  const event = await fixture({ totalRevenue: 100, taxAmount: 0, billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  await db.invoice.create({ data: { number: `PARTIAL-${event.id}`, clientId: client.id, eventId: event.id,
    issueDate: new Date('2026-10-10'), status: 'paid', subtotal: 10, taxAmount: 0, total: 10 } });
  const loaded = await get(event.id), before = await stored(event.id);
  assert.equal(loaded.clientFinance.payment.received, 10);
  assert.equal(loaded.clientFinance.payment.outstanding, 90);
  assert.equal(loaded.clientFinance.archive.canArchive, false);
  assert.equal((await invoicePaidRequest(loaded)).status, 422);
  assert.deepEqual(await stored(event.id), before);
});

test('Fatura paga rejects invalid confirmations, missing date, stale state and insufficient permissions without writes', async () => {
  const event = await fixture(), before = await stored(event.id);
  for (const patch of [{ amount: 1 }, { confirmedTotal: 100 }, { confirmedReceived: 0 }, { receivedAt: '' }, { receivedAt: '2026-02-30' }]) {
    const response = await invoicePaidRequest(event, patch);
    assert.ok([409, 422].includes(response.status));
    assert.deepEqual(await stored(event.id), before);
  }
  const limited = await db.user.create({ data: { name: 'Staff QA', email: `invoice-paid-limited-${event.id}@example.test`, role: 'staff', password: 'test' } });
  const forbidden = { ...headers, Authorization: `Bearer ${issueSessionToken(limited)}` };
  assert.equal((await invoicePaidRequest(event, {}, forbidden)).status, 403);
  assert.deepEqual(await stored(event.id), before);
});

test('Fatura paga rolls back the receipt when updating the actual invoice fails', async () => {
  const event = await fixture({ billingStatus: 'invoiced' }), before = await stored(event.id);
  const invoice = await db.invoice.create({ data: { number: `ROLLBACK-${event.id}`, clientId: client.id, eventId: event.id,
    issueDate: new Date('2026-10-10'), status: 'issued', total: 252 } });
  const failing = { $transaction: (callback) => db.$transaction((tx) => callback({
    event: tx.event, invoice: { findMany: (args) => tx.invoice.findMany(args), updateMany: async () => { throw new Error('controlled invoice failure'); } },
  })) };
  await assert.rejects(settleClientInvoice(failing, event.id, { updatedAt: event.updatedAt, revision: 0,
    confirmedTotal: 252, confirmedReceived: 157.5, amount: 94.5, receivedAt: '2026-10-16' }, { role: 'admin', name: 'QA' }), /controlled invoice failure/);
  assert.deepEqual(await stored(event.id), before);
  assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
});

test('Fatura paga does not settle another service through a grouped invoice', async () => {
  const event = await fixture(), other = await fixture();
  await db.invoice.create({ data: { number: `GROUP-SETTLE-${event.id}`, clientId: client.id, eventIds: JSON.stringify([event.id, other.id]),
    issueDate: new Date('2026-10-10'), status: 'issued', total: 504 } });
  const before = await stored(event.id), otherBefore = await stored(other.id);
  const response = await invoicePaidRequest(await get(event.id));
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /agrupa vários serviços/);
  assert.deepEqual(await stored(event.id), before);
  assert.deepEqual(await stored(other.id), otherBefore);
});

test('calendar metadata: monthly and fortnightly references are calculated by the API, never the browser issue draft', async () => {
  for (const [method, reference, due] of [['monthly', '2026-10-31', '2026-11-15'], ['biweekly', '2026-10-15', '2026-10-30']]) {
    const customer = await db.client.create({ data: { name: `Calendar ${method}`, billingMethod: method, paymentTerm: 'days_15' } });
    let event = await fixture({ clientId: customer.id, billingStatus: 'pending', paidAmount: 0, signaledAmount: 0 });
    const before = await stored(event.id);
    assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: '2026-11-10' })).status, 200);
    event = await get(event.id);
    assert.equal(event.clientFinance.periods[0].referenceDate, reference);
    assert.equal(event.clientFinance.periods[0].dueDate, due);
    assert.equal(readClientPaymentRecord(event.clientPaymentRecord).commercialIssueDate, '2026-11-10');
    assert.deepEqual(invariant(await stored(event.id)), invariant(before));
  }
});

test('manual issue date remains editable and persistent without changing calendar rules, money or other events', async () => {
  const unchangedFields = (row) => {
    const copy = { ...row };
    delete copy.clientPaymentRecord; delete copy.updatedAt;
    return copy;
  };
  for (const [method, reference, due] of [['monthly', '2026-10-31', '2026-11-15'],
    ['biweekly', '2026-10-15', '2026-10-30'], ['per_event', '2026-10-10', '2026-10-25']]) {
    const customer = await db.client.create({ data: { name: `Editable issue ${method}`, billingMethod: method, paymentTerm: 'days_15' } });
    let event = await fixture({ clientId: customer.id, requiredRoles: '[]', totalCost: 204.88,
      externalCosts: '[{"id":"partner","type":"Outro","costAmount":204.88,"marginPercent":0,"vatType":"standard_23"}]' });
    const other = await fixture({ clientId: customer.id }), otherBefore = await stored(other.id);
    const before = await stored(event.id), paymentBefore = clientPaymentSummary(before);
    for (const issueDate of ['', null, '2026-02-30', '2026-10-15T12:00:00Z']) {
      assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate })).status, 422);
      assert.deepEqual(await stored(event.id), before);
    }
    for (const issueDate of ['2026-10-15', '2026-10-16']) {
      const response = await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate });
      assert.equal(response.status, 200, await response.text());
      event = await stored(event.id);
      const record = readClientPaymentRecord(event.clientPaymentRecord), loaded = await get(event.id);
      assert.equal(record.commercialIssueDate, issueDate);
      assert.equal(loaded.clientFinance.periods[0].referenceDate, reference);
      assert.equal(loaded.clientFinance.periods[0].dueDate, due);
      assert.deepEqual(clientPaymentSummary(event), paymentBefore);
      assert.deepEqual(unchangedFields(event), unchangedFields(before));
    }
    const record = readClientPaymentRecord(event.clientPaymentRecord);
    assert.equal(record.commercialChanges.length, 2);
    assert.equal(record.commercialChanges[1].previousIssueDate, '2026-10-15');
    assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: undefined })).status, 200);
    assert.deepEqual(await stored(event.id), event, 'Omitting a date must not overwrite a saved manual date with the calendar reference');
    assert.equal((await put(event.id, { description: 'Descricao atualizada' })).status, 200);
    event = await stored(event.id);
    assert.equal(readClientPaymentRecord(event.clientPaymentRecord).commercialIssueDate, '2026-10-16');
    assert.deepEqual(clientPaymentSummary(event), paymentBefore);
    assert.deepEqual(readClientPaymentRecord(event.clientPaymentRecord).entries, record.entries);
    assert.deepEqual(await stored(other.id), otherBefore);
    assert.equal((await financeRequest(event, 'commercial-status', { status: 'automatic' })).status, 200);
    const automatic = await get(event.id);
    assert.equal(readClientPaymentRecord(automatic.clientPaymentRecord).commercialIssueDate, null);
    assert.equal(automatic.clientFinance.periods[0].referenceDate, reference);
    assert.equal(automatic.clientFinance.periods[0].dueDate, due);
    assert.deepEqual(clientPaymentSummary(automatic), paymentBefore);
  }
});

test('manual period allocation validates every cent, persists without touching money, and rejects stale/duplicate/foreign periods', async () => {
  const customer = await db.client.create({ data: { name: 'Manual allocation QA', billingMethod: 'biweekly', paymentTerm: 'days_15' } });
  let event = await fixture({ clientId: customer.id, date: new Date('2026-10-14'), endDate: new Date('2026-10-16'), isContinuous: true,
    totalRevenue: 738, taxAmount: 138, paidAmount: 100, signaledAmount: 100 });
  const before = await stored(event.id), initial = await get(event.id);
  assert.equal(initial.clientFinance.allocationRequired, true);
  const periods = [{ key: 'biweekly:2026-10:1', globalTotal: 295.2, globalTax: 55.2, received: 100 },
    { key: 'biweekly:2026-10:2', globalTotal: 442.8, globalTax: 82.8, received: 0 }];
  for (const invalid of [periods.slice(0, 1), [periods[0], periods[0]], [periods[0], { ...periods[1], key: 'foreign' }],
    [periods[0], { ...periods[1], globalTotal: 442.79 }], [periods[0], { ...periods[1], globalTax: 82.79 }],
    [{ ...periods[0], received: 99.99 }, periods[1]], [{ ...periods[0], globalTax: 500 }, periods[1]],
    [{ ...periods[0], globalTotal: -1 }, periods[1]]]) {
    assert.equal((await metadataRequest(event, { action: 'allocate', periods: invalid })).status, 422);
    assert.deepEqual(await stored(event.id), before);
  }
  const response = await metadataRequest(event, { action: 'allocate', periods });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json();
  assert.equal(saved.clientFinance.allocationRequired, false);
  assert.deepEqual(saved.clientFinance.periods.map((part) => [part.total, part.received, part.outstanding]), [[295.2, 100, 195.2], [442.8, 0, 442.8]]);
  assert.equal((await metadataRequest(event, { action: 'allocate', periods })).status, 409);
  event = await stored(event.id);
  const { clientPaymentRecord: _oldRecord, updatedAt: _oldUpdated, ...originalData } = before;
  const { clientPaymentRecord: _newRecord, updatedAt: _newUpdated, ...savedData } = event;
  assert.deepEqual(savedData, originalData); assert.equal(readClientPaymentRecord(event.clientPaymentRecord).financeChanges.length, 1);
  assert.equal(receiptMovements(event.clientPaymentRecord).rows[0].amount, 100, 'A legacy signal remains visible after saving period metadata');
  assert.equal((await get(event.id)).clientFinance.allocationRequired, false);
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 738, confirmedReceived: 100 })).status, 422);
});

test('explicit archive and restore preserve receipts/history, block unpaid or future events and reopen after a receipt reversal', async () => {
  let event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 252, confirmedReceived: 0 })).status, 422);
  assert.equal((await financeRequest(event, 'receive', { type: 'signal', amount: 252, receivedAt: '2026-10-16' })).status, 200);
  event = await stored(event.id);
  let dto = await get(event.id);
  assert.equal(dto.clientFinance.archive.archived, false); assert.equal(dto.clientFinance.archive.needsConfirmation, true);
  const receipts = readClientPaymentRecord(event.clientPaymentRecord).entries;
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 251, confirmedReceived: 252 })).status, 409);
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 252, confirmedReceived: 252 })).status, 200);
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 252, confirmedReceived: 252 })).status, 409);
  event = await stored(event.id); dto = await get(event.id);
  assert.equal(dto.clientFinance.archive.archived, true); assert.deepEqual(readClientPaymentRecord(event.clientPaymentRecord).entries, receipts);
  assert.equal((await metadataRequest(event, { action: 'restore' })).status, 200);
  event = await stored(event.id); assert.equal((await get(event.id)).clientFinance.archive.archived, false);
  assert.equal((await metadataRequest(event, { action: 'archive', confirmedTotal: 252, confirmedReceived: 252 })).status, 200);
  event = await stored(event.id);
  assert.equal((await movementRequest(event, receiptMovements(event.clientPaymentRecord).rows[0], { action: 'reverse' })).status, 200);
  dto = await get(event.id);
  assert.equal(dto.clientFinance.payment.outstanding, 252); assert.equal(dto.clientFinance.archive.archived, false);
  assert.deepEqual(readClientPaymentRecord(dto.clientPaymentRecord).entries.slice(0, receipts.length), receipts);
  event = await stored(event.id);
  assert.equal((await financeRequest(event, 'receive', { type: 'signal', amount: 252, receivedAt: '2026-10-17' })).status, 200);
  assert.equal((await get(event.id)).clientFinance.archive.archived, false, 'A later repayment must not resurrect an old archive confirmation');
  const future = await fixture({ date: new Date('2099-01-01'), billingStatus: 'paid', paidAmount: 252, clientPaymentRecord: JSON.stringify({ version: 1, entries: [], financeWorkflowVersion: 2 }) });
  assert.equal((await metadataRequest(future, { action: 'archive', confirmedTotal: 252, confirmedReceived: 252 })).status, 422);
});

test('period/archive metadata requires financial permissions and compare-and-swap; failures roll back without replacing receipts', async () => {
  const event = await fixture({ billingStatus: 'paid', paidAmount: 252 }), before = await stored(event.id);
  const limited = await db.user.create({ data: { name: 'Metadata limited', email: 'metadata-limited@example.test', password: 'qa', role: 'operations', permissionOverrides: '{"deny":["finance.updatePayments"]}' } });
  assert.equal((await metadataRequest(event, { action: 'restore' }, { ...headers, Authorization: `Bearer ${issueSessionToken(limited)}` })).status, 403);
  assert.equal((await metadataRequest(event, { action: 'restore' }, { 'Content-Type': 'application/json' })).status, 401);
  const readbackFailure = { $transaction: (callback) => db.$transaction(async (tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: { ...tx.event, findUnique: (args) => { if (++reads > 1) throw new Error('forced readback failure'); return tx.event.findUnique(args); } } });
  }) };
  await assert.rejects(updateClientFinancialMetadata(readbackFailure, event.id, { action: 'restore', updatedAt: event.updatedAt, revision: 0 }), /forced readback/);
  assert.deepEqual(await stored(event.id), before);
  const concurrent = { $transaction: (callback) => db.$transaction((tx) => callback({ invoice: tx.invoice, event: { ...tx.event, updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(updateClientFinancialMetadata(concurrent, event.id, { action: 'restore', updatedAt: event.updatedAt, revision: 0 }), { statusCode: 409 });
  assert.deepEqual(await stored(event.id), before);
});

test('Finance manager registers a signal and partial/full receipts, preserving manual invoiced choice and all operational/pricing fields', async () => {
  let event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const original = await stored(event.id);
  assert.equal((await financeRequest(event, 'receive', { amount: 100, type: 'signal', receivedAt: '2026-10-16' })).status, 200);
  event = await stored(event.id); assert.equal(clientFinancialState(event).label, 'Sinalizado');
  const signal = readClientPaymentRecord(event.clientPaymentRecord).entries[0];
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced' })).status, 200);
  event = await stored(event.id); assert.equal(clientFinancialState(event).label, 'Faturado');
  assert.equal((await financeRequest(event, 'receive', { amount: 50, type: 'remaining', receivedAt: '2026-10-20', description: 'Transferência parcial' })).status, 200);
  event = await stored(event.id); assert.equal(clientFinancialState(event).outstanding, 102); assert.equal(clientFinancialState(event).label, 'Faturado');
  assert.equal((await financeRequest(event, 'receive', { amount: 102, type: 'remaining', receivedAt: '2026-10-21' })).status, 200);
  event = await stored(event.id); assert.equal(clientFinancialState(event).label, 'Totalmente Pago');
  assert.deepEqual(readClientPaymentRecord(event.clientPaymentRecord).entries[0], signal);
  assert.deepEqual(invariant(event), invariant(original));
  const last = receiptMovements(event.clientPaymentRecord).rows.at(-1);
  assert.equal((await movementRequest(event, last, { action: 'reverse' })).status, 200);
  event = await stored(event.id); assert.equal(clientFinancialState(event).label, 'Faturado'); assert.equal(clientFinancialState(event).outstanding, 102);
});

test('Finance manager does not accept manually paid states, stale writes, invalid receipt types or insufficient permission', async () => {
  const event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const original = await stored(event.id);
  for (const input of [{ status: 'paid' }, { status: 'partial' }, { status: 'invoiced', updatedAt: '2000-01-01' }]) {
    const response = await financeRequest(event, 'commercial-status', input);
    assert.ok([409, 422].includes(response.status));
  }
  assert.equal((await financeRequest(event, 'receive', { amount: 500, type: 'signal', receivedAt: '2026-10-16' })).status, 422);
  assert.equal((await financeRequest(event, 'receive', { amount: 50, type: '__proto__', receivedAt: '2026-10-16' })).status, 422);
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced' }, { 'Content-Type': 'application/json' })).status, 401);
  const limited = await db.user.create({ data: { name: 'Finance limited', email: 'finance-manager-limited@example.test', password: 'qa', role: 'operations',
    permissionOverrides: '{"deny":["finance.updatePayments"]}' } });
  const auth = { ...headers, Authorization: `Bearer ${issueSessionToken(limited)}` };
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced' }, auth)).status, 403);
  assert.equal((await financeRequest(event, 'receive', { type: 'signal', amount: 50, receivedAt: '2026-10-16' }, auth)).status, 403);
  assert.deepEqual(await stored(event.id), original);
});

test('Finance manager accepts localized amounts and retains the actual date when a signal covers the full total', async () => {
  const event = await fixture({ billingStatus: 'pending', totalRevenue: 1000, paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const response = await financeRequest(event, 'receive', { amount: '1.000,00', type: 'signal', receivedAt: '2026-10-17' });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await stored(event.id);
  assert.equal(Number(saved.paidAmount), 1000); assert.equal(Number(saved.signaledAmount), 1000);
  assert.equal(saved.signaledAt.toISOString().slice(0, 10), '2026-10-17');
  assert.equal(saved.billingPaymentDate.toISOString().slice(0, 10), '2026-10-17');
  assert.equal(clientFinancialState(saved).label, 'Totalmente Pago');
});

test('Finance manager keeps issued invoices authoritative and rejects duplicate partial receipts and status submissions', async () => {
  let event = await fixture({ billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const first = await financeRequest(event, 'receive', { amount: 50, type: 'signal', receivedAt: '2026-10-16' });
  assert.equal(first.status, 200);
  assert.equal((await financeRequest(event, 'receive', { amount: 50, type: 'signal', receivedAt: '2026-10-16' })).status, 409);
  event = await stored(event.id);
  const results = await Promise.all([financeRequest(event, 'commercial-status', { status: 'invoiced' }), financeRequest(event, 'commercial-status', { status: 'invoiced' })]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  event = await stored(event.id);
  await db.invoice.create({ data: { clientId: client.id, number: 'FINANCE-MANAGER-ISSUED', status: 'issued', total: 252,
    eventIds: JSON.stringify([event.id]), issueDate: new Date('2026-10-16') } });
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'automatic' })).status, 409);
  assert.equal((await financeRequest(event, 'receive', { type: 'remaining', amount: 50, receivedAt: '2026-10-20' })).status, 409);
  assert.deepEqual(await stored(event.id), event);
});

test('manual invoicing requires an actual issue date and audits changes without touching financial data', async () => {
  const custom = await db.client.create({ data: { name: 'Custom manual reference', billingMethod: 'custom', billingCustomRule: 'Referência manual', paymentTerm: 'days_15' } });
  let event = await fixture({ clientId: custom.id, billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  const original = await stored(event.id);
  for (const issueDate of [null, '', '2026-02-30', '2026-10-15T12:00:00Z', 'not-a-date']) {
    assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate })).status, 422);
    assert.deepEqual(await stored(event.id), original);
  }
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: '2026-10-15' })).status, 200);
  event = await stored(event.id);
  let record = readClientPaymentRecord(event.clientPaymentRecord);
  assert.equal(record.commercialIssueDate, '2026-10-15');
  assert.equal(record.commercialChanges.length, 1); assert.equal(record.commercialChanges[0].issueDate, '2026-10-15');
  assert.deepEqual(invariant(event), invariant(original)); assert.equal(Number(event.paidAmount), 0);
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: '2026-10-14' })).status, 200);
  event = await stored(event.id); record = readClientPaymentRecord(event.clientPaymentRecord);
  assert.equal(record.commercialIssueDate, '2026-10-14'); assert.equal(record.commercialChanges[1].previousIssueDate, '2026-10-15');
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'automatic' })).status, 200);
  event = await stored(event.id); record = readClientPaymentRecord(event.clientPaymentRecord);
  assert.equal(record.commercialIssueDate, null); assert.equal(record.commercialChanges[2].previousIssueDate, '2026-10-14');
  assert.deepEqual(invariant(event), invariant(original));
});

test('legacy invoiced events can record/correct missing issue dates without unlocking prices or rewriting real invoices', async () => {
  let event = await fixture({ billingStatus: 'invoiced' });
  const original = await stored(event.id);
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: '2026-10-15' })).status, 200);
  event = await stored(event.id);
  assert.equal(readClientPaymentRecord(event.clientPaymentRecord).legacyInvoiced, true);
  assert.equal(readClientPaymentRecord(event.clientPaymentRecord).commercialIssueDate, '2026-10-15');
  assert.equal(eventRevenueIsLocked(event), true); assert.deepEqual(invariant(event), invariant(original));
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'automatic' })).status, 409);
  assert.equal((await put(event.id, { requiredRoles: [] })).status, 409);
  await db.invoice.create({ data: { clientId: client.id, eventId: event.id, number: 'MANUAL-ISSUE-REAL',
    status: 'issued', total: 252, issueDate: new Date('2026-10-12') } });
  assert.equal((await financeRequest(event, 'commercial-status', { status: 'invoiced', issueDate: '2026-10-16' })).status, 409);
  assert.deepEqual(await stored(event.id), event);
});

test('Finance manager can settle a legacy invoiced event without an associated invoice and preserve financial closure', async () => {
  let event = await fixture({ billingStatus: 'invoiced', totalRevenue: 295.2, taxAmount: 55.2,
    paidAmount: 0, signaledAmount: 0, signaledAt: null, remainingPaymentDate: null });
  const original = await stored(event.id);
  const response = await financeRequest(event, 'receive', { amount: 100, type: 'remaining', receivedAt: '2026-10-17' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await financeRequest(event, 'receive', { amount: 100, type: 'remaining', receivedAt: '2026-10-17' })).status, 409);
  event = await stored(event.id);
  assert.equal(clientFinancialState(event).label, 'Faturado');
  assert.equal(clientPaymentSummary(event).outstanding, 195.2);
  assert.equal(eventRevenueIsLocked(event), true);
  assert.equal(readClientPaymentRecord(event.clientPaymentRecord).legacyInvoiced, true);
  assert.equal((await financeRequest(event, 'receive', { amount: 195.2, type: 'remaining', receivedAt: '2026-10-18' })).status, 200);
  event = await stored(event.id);
  assert.equal(clientFinancialState(event).label, 'Totalmente Pago');
  assert.equal(Number(event.paidAmount), 295.2); assert.equal(Number(event.signaledAmount), 0);
  assert.equal(event.billingPaymentDate.toISOString().slice(0, 10), '2026-10-18');
  assert.equal(receiptMovements(event.clientPaymentRecord).rows.length, 2);
  assert.equal(splitClientBillingRows([{ nonInvoicedServices: [event] }]).archivedRows.length, 0, 'A newly settled service requires explicit archive confirmation');
  assert.deepEqual(invariant(event), invariant(original));
  assert.equal((await put(event.id, { requiredRoles: [{ role: 'Bar', qty: 1, agreedRate: 20 }] })).status, 409);
  assert.deepEqual(await stored(event.id), event);
});

test('settling legacy invoiced events cannot complete Staff operations or archive them early', async () => {
  const event = await fixture({ billingStatus: 'invoiced', status: 'in_progress', paidAmount: 0, signaledAmount: 0, signaledAt: null });
  assert.equal((await financeRequest(event, 'receive', { amount: 252, type: 'remaining', receivedAt: '2026-10-17' })).status, 200);
  const saved = await stored(event.id);
  assert.equal(clientFinancialState(saved).label, 'Totalmente Pago'); assert.equal(saved.status, 'in_progress');
  assert.equal(splitClientBillingRows([{ nonInvoicedServices: [saved] }]).archivedRows.length, 0);
});

async function movementFixture(adjustment = false) {
  let event = await fixture({ totalRevenue: 1392.36, taxAmount: 260.36, staffVatRateSnapshot: 23,
    billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null, billingPaymentDate: null });
  let patch = { billingStatus: 'partial70', paidAmount: 200, signaledAmount: 200, signaledAt: new Date('2026-10-16') };
  event = await db.event.update({ where: { id: event.id }, data: { ...patch, ...clientPaymentRecordPatch(event, patch) } });
  patch = { billingStatus: 'paid', paidAmount: 1392.36, billingPaymentDate: new Date('2026-10-20') };
  event = await db.event.update({ where: { id: event.id }, data: { ...patch, ...clientPaymentRecordPatch(event, patch) } });
  event = await db.event.update({ where: { id: event.id }, data: { totalRevenue: 1426.8, taxAmount: 266.8 } });
  if (adjustment) event = await receiveAdditionalClientPayment(db, event.id, { updatedAt: event.updatedAt, amount: 34.44, receivedAt: '2026-10-25' });
  return event;
}

function movementRequest(event, row, input = {}, auth = headers) {
  return fetch(`${base}/${event.id}/client-payment/movements/${encodeURIComponent(row.id)}`, { method: 'POST', headers: auth,
    body: JSON.stringify({ updatedAt: event.updatedAt, revision: readClientPaymentRecord(event.clientPaymentRecord)?.entries.length || 0,
      confirmedAmount: row.amount, action: 'edit', amount: row.amount, type: row.type, receivedAt: '2026-10-20', ...input }) });
}

test('individual receipt: correcting 1192.36 to 1200 recalculates only the actual balance, never registers a forecast as cash', async () => {
  const event = await movementFixture(); const original = await stored(event.id);
  const record = readClientPaymentRecord(event.clientPaymentRecord), row = record.entries[1];
  const response = await movementRequest(event, row, { amount: '1200,00', description: 'Correção da transferência' });
  assert.equal(response.status, 200, await response.clone().text());
  const next = await stored(event.id), summary = clientPaymentSummary(next), history = readClientPaymentRecord(next.clientPaymentRecord);
  assert.equal(summary.received, 1400); assert.equal(summary.outstanding, 26.8);
  assert.equal(Number(next.signaledAmount), 200); assert.deepEqual(invariant(next), invariant(original));
  assert.deepEqual(history.entries.slice(0, 2), record.entries); assert.equal(history.entries.at(-1).amount, 7.64);
  assert.equal(receiptMovements(history).rows.length, 2); assert.equal(history.entries.at(-1).operation, 'edit');
  assert.ok(history.entries.at(-1).actor.id);
  const tax = clientReceiptTaxSummary(next, summary.received);
  assert.deepEqual([tax.outstanding.base, tax.outstanding.tax, tax.outstanding.total], [21.79, 5.01, 26.8]);
});

test('individual receipt: reversing only the final adjustment preserves signal, remainder and immutable original entries', async () => {
  const event = await movementFixture(true), record = readClientPaymentRecord(event.clientPaymentRecord);
  const response = await movementRequest(event, record.entries[2], { action: 'reverse' });
  assert.equal(response.status, 200, await response.clone().text());
  const next = await stored(event.id), history = readClientPaymentRecord(next.clientPaymentRecord);
  assert.equal(clientPaymentSummary(next).received, 1392.36); assert.equal(clientPaymentSummary(next).outstanding, 34.44);
  assert.deepEqual(history.entries.slice(0, 3), record.entries);
  assert.deepEqual(receiptMovements(history).rows.map((row) => [row.amount, Boolean(row.voided)]), [[200, false], [1192.36, false], [34.44, true]]);
  assert.equal(next.status, event.status);
});

test('individual receipt: a recorded final receipt does not lock previous movements or silently shrink actual receipts', async () => {
  const event = await movementFixture(true), record = readClientPaymentRecord(event.clientPaymentRecord);
  const response = await movementRequest(event, record.entries[0], { amount: 250, receivedAt: '2026-10-16', type: 'signal' });
  assert.equal(response.status, 200);
  const next = await stored(event.id);
  assert.equal(clientPaymentSummary(next).received, 1476.8);
  assert.deepEqual(receiptMovements(next.clientPaymentRecord).rows.map((row) => row.amount), [250, 1192.36, 34.44]);
});

test('individual receipt: date, description and type changes are audited without moving money', async () => {
  const event = await movementFixture(true), row = readClientPaymentRecord(event.clientPaymentRecord).entries[1];
  const response = await movementRequest(event, row, { receivedAt: '2026-10-21', type: 'adjustment', description: 'Acerto confirmado pelo cliente' });
  assert.equal(response.status, 200);
  const next = await stored(event.id), record = readClientPaymentRecord(next.clientPaymentRecord);
  assert.equal(clientPaymentSummary(next).received, 1426.8); assert.equal(record.entries.at(-1).amount, 0);
  assert.equal(receiptMovements(record).rows[1].description, 'Acerto confirmado pelo cliente');
  assert.equal(next.billingPaymentDate.toISOString().slice(0, 10), '2026-10-25');
});

test('individual receipt: stale/double submissions and receipts from another event are rejected atomically', async () => {
  const event = await movementFixture(), row = readClientPaymentRecord(event.clientPaymentRecord).entries[1];
  const results = await Promise.all([movementRequest(event, row, { action: 'reverse' }), movementRequest(event, row, { action: 'reverse' })]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const current = await stored(event.id);
  assert.equal(readClientPaymentRecord(current.clientPaymentRecord).entries.length, 3);
  assert.equal((await movementRequest(current, { ...row, id: 'foreign-id' })).status, 404);
});

test('individual receipt: invalid amount/date/type/distribution preserve all data', async () => {
  const event = await movementFixture(true), row = readClientPaymentRecord(event.clientPaymentRecord).entries[1];
  const original = await stored(event.id);
  for (const input of [{ amount: 0 }, { amount: -1 }, { amount: 10.001 }, { amount: 1e10 }, { receivedAt: '2026-02-30' },
    { receivedAt: '2026-10-15' }, { type: '__proto__' }, { type: 'reversal' }, { allocations: {} },
    { allocations: [{ key: 'staff', amount: 1 }] }, { allocations: [null] }]) {
    const response = await movementRequest(event, row, input);
    assert.ok([409, 422].includes(response.status), `${response.status}: ${JSON.stringify(input)} ${await response.text()}`);
    assert.deepEqual(await stored(event.id), original);
  }
});

test('individual receipt: deleting a signal retains an audit tombstone', async () => {
  let event = await fixture({ paidAmount: 0, signaledAmount: 0, billingStatus: 'pending', signaledAt: null });
  const patch = { billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100, signaledAt: new Date('2026-10-16') };
  event = await db.event.update({ where: { id: event.id }, data: { ...patch, ...clientPaymentRecordPatch(event, patch) } });
  const original = readClientPaymentRecord(event.clientPaymentRecord), row = original.entries[0];
  const response = await movementRequest(event, row, { action: 'delete' }); assert.equal(response.status, 200);
  const next = await stored(event.id), record = readClientPaymentRecord(next.clientPaymentRecord);
  assert.equal(clientPaymentSummary(next).received, 0); assert.deepEqual(record.entries[0], row);
  assert.equal(record.entries[1].operation, 'delete'); assert.equal(receiptMovements(record).rows[0].voided, 'delete');
  assert.equal((await movementRequest(next, row, { action: 'delete' })).status, 409);
});

test('individual receipt: deleting a remaining receipt after final settlement preserves the other receipts and their originals', async () => {
  const event = await movementFixture(true), record = readClientPaymentRecord(event.clientPaymentRecord), row = record.entries[1];
  const original = await stored(event.id);
  const response = await movementRequest(event, row, { action: 'delete' });
  assert.equal(response.status, 200, await response.clone().text());
  const next = await stored(event.id), nextRecord = readClientPaymentRecord(next.clientPaymentRecord);
  assert.equal(clientPaymentSummary(next).received, 234.44);
  assert.equal(clientPaymentSummary(next).outstanding, 1192.36);
  assert.deepEqual(nextRecord.entries.slice(0, 3), record.entries);
  assert.deepEqual(receiptMovements(nextRecord).rows.map((item) => [item.amount, item.voided || null]), [[200, null], [1192.36, 'delete'], [34.44, null]]);
  assert.deepEqual(invariant(next), invariant(original));
  assert.equal(nextRecord.entries.at(-1).actor.name, 'QA');
  assert.equal((await movementRequest(next, row, { action: 'delete' })).status, 409);
});

test('deleting individually and globally reversed receipts changes only audit, never any financial field', async () => {
  for (const global of [false, true]) {
    let event = await movementFixture(true);
    const row = receiptMovements(event.clientPaymentRecord).rows[0];
    const reversed = global ? await reverseReceipts(event) : await movementRequest(event, row, { action: 'reverse' });
    assert.equal(reversed.status, 200);
    event = await stored(event.id);
    const previous = readClientPaymentRecord(event.clientPaymentRecord);
    assert.equal((await movementRequest(event, row, { action: 'edit' })).status, 409);
    assert.equal((await movementRequest(event, row, { action: 'reverse' })).status, 409);
    const responses = await Promise.all([movementRequest(event, row, { action: 'delete' }), movementRequest(event, row, { action: 'delete' })]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409],
      `global=${global}: ${await responses[0].clone().text()} / ${await responses[1].clone().text()}`);
    const next = await stored(event.id);
    const { clientPaymentRecord: _before, updatedAt: _oldDate, ...beforeFields } = event;
    const { clientPaymentRecord: _after, updatedAt: _newDate, ...afterFields } = next;
    assert.deepEqual(afterFields, beforeFields);
    const journal = readClientPaymentRecord(next.clientPaymentRecord);
    assert.deepEqual(journal.entries.slice(0, -1), previous.entries);
    assert.equal(journal.entries.at(-1).amount, 0);
    assert.equal(journal.entries.at(-1).actor.name, 'QA');
    assert.equal(journal.entries.at(-1).before.voided, 'reverse');
    assert.equal(receiptMovements(journal).reliable, true);
    assert.equal(receiptMovements(journal).rows[0].voided, 'delete');
    assert.equal((await movementRequest(next, row, { action: 'delete' })).status, 409);
  }
});

test('deleting a reversed receipt still enforces invoice and payment permissions', async () => {
  let event = await movementFixture(true), row = receiptMovements(event.clientPaymentRecord).rows[0];
  assert.equal((await movementRequest(event, row, { action: 'reverse' })).status, 200);
  event = await stored(event.id);
  assert.equal((await movementRequest(event, row, { action: 'delete' }, { 'Content-Type': 'application/json' })).status, 401);
  const user = await db.user.create({ data: { name: 'Limited reverse delete', email: 'reversed-delete@example.test', password: 'qa', role: 'operations',
    permissionOverrides: JSON.stringify({ deny: ['finance.updatePayments'] }) } });
  assert.equal((await movementRequest(event, row, { action: 'delete' }, { ...headers, Authorization: `Bearer ${issueSessionToken(user)}` })).status, 403);
  await db.invoice.create({ data: { number: `REVERSED-DELETE-${sequence}`, clientId: client.id, total: 1426.8,
    status: 'issued', issueDate: new Date('2026-10-20'), eventIds: JSON.stringify([event.id]) } });
  assert.equal((await movementRequest(event, row, { action: 'delete' })).status, 409);
  assert.deepEqual(await stored(event.id), event);
});

test('individual receipt: legacy data is materialized only on correction and implicit receipts retain their independent values', async () => {
  const event = await fixture({ billingStatus: 'paid', paidAmount: 0, billingPaymentDate: null });
  assert.equal(event.clientPaymentRecord, null);
  const response = await movementRequest(event, { id: 'legacy-remaining', amount: 94.5, type: 'remaining' }, { amount: 100, receivedAt: '2026-10-20' });
  assert.equal(response.status, 200, await response.clone().text());
  const next = await stored(event.id);
  assert.equal(clientPaymentSummary(next).received, 257.5); assert.equal(Number(next.signaledAmount), 157.5);
  assert.equal(receiptMovements(next.clientPaymentRecord).rows.length, 2);
});

test('receipt tax: mixed partial payment uses explicitly selected components and invalid distributions roll back', async () => {
  const event = await fixture({ totalRevenue: 337.5, taxAmount: 37.5, staffVatRateSnapshot: 23, paidAmount: 0, signaledAmount: 0,
    signaledAt: null, billingStatus: 'pending', externalCosts: JSON.stringify(normalizeExternalCosts([
      { id: 'exempt', type: 'Outro', costAmount: 100, vatType: 'exempt' }, { id: 'catering', type: 'Catering', costAmount: 100, vatType: 'catering' },
    ])) });
  const body = { ...buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'partial70', signaledAmount: 150, signaledAt: '2026-10-20' }, event), receiptAllocationUpdatedAt: event.updatedAt };
  const invalid = await put(event.id, { ...body, receiptAllocations: [{ key: 'staff', amount: 149 }] });
  assert.equal(invalid.status, 422); assert.equal(Number((await stored(event.id)).paidAmount), 0);
  const valid = await put(event.id, { ...body, receiptAllocations: [{ key: 'staff', amount: 123 }, { key: 'partner:exempt', amount: 27 }] });
  assert.equal(valid.status, 200, await valid.clone().text());
  const saved = await stored(event.id), tax = clientReceiptTaxSummary(saved, 150);
  assert.equal(readClientPaymentRecord(saved.clientPaymentRecord).entries[0].actor.name, 'QA');
  assert.deepEqual([tax.received.base, tax.received.tax, tax.outstanding.base, tax.outstanding.tax], [127, 23, 173, 14.5]);
  const row = receiptMovements(saved.clientPaymentRecord).rows[0];
  const edited = await movementRequest(saved, row, { amount: 160, type: 'signal',
    allocations: [{ key: 'staff', amount: 123 }, { key: 'partner:exempt', amount: 37 }] });
  assert.equal(edited.status, 200, await edited.clone().text());
  const corrected = await stored(event.id), correctedTax = clientReceiptTaxSummary(corrected, 160);
  assert.deepEqual([correctedTax.received.base, correctedTax.received.tax, correctedTax.outstanding.base, correctedTax.outstanding.tax], [137, 23, 163, 14.5]);
  assert.deepEqual(invariant(corrected), invariant(saved));
});

test('individual receipt enforces both permissions and issued direct/grouped invoice protection', async () => {
  const event = await movementFixture(), row = receiptMovements(event.clientPaymentRecord).rows[0];
  const original = await stored(event.id);
  assert.equal((await movementRequest(event, row, { action: 'reverse' }, { 'Content-Type': 'application/json' })).status, 401);
  for (const permission of ['services.update', 'finance.updatePayments']) {
    const user = await db.user.create({ data: { name: 'Limited', email: `movement-${permission}@example.test`, password: 'qa', role: 'operations',
      permissionOverrides: JSON.stringify({ deny: [permission] }) } });
    const auth = { ...headers, Authorization: `Bearer ${issueSessionToken(user)}` };
    assert.equal((await movementRequest(event, row, { action: 'reverse' }, auth)).status, 403);
  }
  assert.deepEqual(await stored(event.id), original);
  for (const grouped of [false, true]) {
    const invoice = await db.invoice.create({ data: { number: `MOVEMENT-LOCK-${sequence}-${grouped}`, clientId: client.id, total: 1426.8,
      status: 'issued', issueDate: new Date('2026-10-20'), ...(grouped ? { eventIds: JSON.stringify([event.id]) } : { eventId: event.id }) } });
    for (const action of ['edit', 'reverse', 'delete']) assert.equal((await movementRequest(event, row, { action })).status, 409);
    assert.deepEqual(await stored(event.id), original);
    assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
    await db.invoice.delete({ where: { id: invoice.id } });
  }
});

test('individual receipt correction rolls back on readback failure and rejects a concurrent database update', async () => {
  const event = await movementFixture(), original = await stored(event.id), row = receiptMovements(event.clientPaymentRecord).rows[0];
  const input = { action: 'reverse', updatedAt: event.updatedAt, revision: 2, confirmedAmount: row.amount };
  const failing = { $transaction: (callback) => db.$transaction((tx) => {
    let reads = 0;
    return callback({ invoice: tx.invoice, event: {
      findUnique: (args) => { if (++reads > 1) throw new Error('individual receipt rollback'); return tx.event.findUnique(args); },
      updateMany: (args) => tx.event.updateMany(args),
    } });
  }) };
  await assert.rejects(changeClientReceipt(failing, event.id, row.id, input), /individual receipt rollback/);
  assert.deepEqual(await stored(event.id), original);
  const conflict = { $transaction: (callback) => db.$transaction((tx) => callback({ invoice: tx.invoice,
    event: { findUnique: (args) => tx.event.findUnique(args), updateMany: async () => ({ count: 0 }) } })) };
  await assert.rejects(changeClientReceipt(conflict, event.id, row.id, input), { statusCode: 409 });
  assert.deepEqual(await stored(event.id), original);
});

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

test('billing adjustment inherits event VAT, persists once, and preserves receipt history', async () => {
  let event = await fixture({ totalRevenue: 3130.35, taxAmount: 585.35, staffVatRateSnapshot: 23,
    paidAmount: 0, signaledAmount: 0, billingStatus: 'pending', requiredRoles: '[]',
    externalCosts: '[{"id":"partner","type":"Outro","costAmount":2545,"marginPercent":0,"vatType":"standard_23"}]' });
  const paidPatch = { billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100 };
  event = await db.event.update({ where: { id: event.id }, data: { ...paidPatch, ...clientPaymentRecordPatch(event, paidPatch) } });
  const originalEntries = readClientPaymentRecord(event.clientPaymentRecord).entries;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await put(event.id, { billingAdjustment: 5 });
    assert.equal(response.status, 200, await response.text());
    const visible = await get(event.id);
    assert.equal(visible.clientFinance.payment.total, 3136.5);
    assert.equal(visible.clientFinance.payment.outstanding, 3036.5);
    assert.equal(visible.clientFinance.periods[0].tax, 586.5);
    const saved = await stored(event.id);
    assert.equal(Number(saved.totalRevenue), 3130.35);
    assert.equal(Number(saved.taxAmount), 585.35);
    assert.equal(Number(saved.paidAmount), 100);
    assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord).entries, originalEntries);
  }
  const taxFree = await fixture({ totalRevenue: 2545, taxAmount: 0, staffVatRateSnapshot: 0,
    paidAmount: 0, signaledAmount: 0, billingStatus: 'pending', requiredRoles: '[]',
    externalCosts: '[{"id":"partner","type":"Outro","costAmount":2545,"marginPercent":0,"vatType":"exempt"}]' });
  assert.equal((await put(taxFree.id, { billingAdjustment: 5 })).status, 200);
  const visible = await get(taxFree.id);
  assert.equal(visible.clientFinance.payment.total, 2550);
  assert.equal(visible.clientFinance.periods[0].tax, 0);
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
