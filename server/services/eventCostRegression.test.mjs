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
import { eventCostSummary } from '../../src/utils/eventCostSummary.js';
import { buildClientFinancialSummary } from '../../src/utils/clientFinancialSummary.js';
import { staffAssignmentPaymentTotal } from '../../src/utils/staffPayment.js';
import { normalizeExternalCosts } from '../../src/utils/externalCosts.js';
import { buildImportPreview } from '../utils/timeValidationExcelImport.js';
import { registerPublicQr } from './qrAttendance.js';
import { synchronizeEventWorkflow } from './eventWorkflow.js';
import { buildBudgetConversionDraft, buildEventPayloadFromBudgetConversion } from '../../src/utils/budgetConversion.js';
import { buildClientPaymentPayload, clientPaymentDraft, clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { clientPaymentAssessment, readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { prepaymentReferenceAmounts } from '../../src/utils/prepaymentPolicy.js';

const directory = mkdtempSync(join(tmpdir(), 'es-staff-client-price-'));
const database = join(directory, 'test.db'), datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl; process.env.JWT_SECRET = 'event-cost-regression-not-production';
const db = new PrismaClient({ datasourceUrl });
let prisma, server, base, headers, sequence = 0;
before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database); sqlite.exec(migration.stdout); sqlite.close();
  const { apiRouter } = await import('../routes/index.js'); ({ prisma } = await import('../prisma.js'));
  const admin = await db.user.create({ data: { email: 'cost-price-admin@example.test', name: 'QA', role: 'admin', password: 'qa' } });
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { Authorization: `Bearer ${issueSessionToken(admin)}`, 'Content-Type': 'application/json' };
});
after(async () => {
  if (server) await new Promise((done) => server.close(done));
  await prisma?.$disconnect(); await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory);
});
async function request(path, method = 'GET', payload) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const body = response.status === 204 ? null : await response.json(); assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
async function createFixture(vatRateSnapshot = 0) {
  const client = await db.client.create({ data: { name: `FIC Restaurante QA ${++sequence}`, billingMethod: 'per_event',
    paymentTerm: 'days_15', roleRates: '[{"role":"Emp.Mesa","rate":10}]' } });
  const event = await request('/services', 'POST', { name: 'FIC Restaurante - FIXOS', clientId: client.id, date: '2026-10-16',
    startTime: '10:00', endTime: '00:00', status: 'in_progress', statusMode: 'manual', vatRateSnapshot,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 2 }], externalCosts: [{ id: 'partner', type: 'Aluguer', supplier: 'alugaqui',
      costAmount: 430, marginPercent: 0, vatType: 'standard_23' }] });
  for (let index = 0; index < 2; index += 1) {
    const collaborator = await db.collaborator.create({ data: { name: `Pessoa QA ${sequence}-${index}`,
      email: `cost-regression-${sequence}-${index}@example.test`, hourlyRate: 8 } });
    await request('/assignments', 'POST', { eventId: event.id, collaboratorId: collaborator.id, role: 'Emp.Mesa', status: 'confirmed',
      assignmentDate: '2026-10-16', plannedCheckIn: '10:00', plannedCheckOut: '00:00', hourlyRate: 8,
      checkIn: '10:00', checkOut: '00:00', clientCheckIn: '10:00', clientCheckOut: '00:00', validationStatus: 'validated' });
  }
  return request(`/services/${event.id}`);
}

test('HTTP FIC configuration -> snapshotted client price -> persisted totals -> client summary and staff payroll', async () => {
  const event = await createFixture();
  assert.equal(JSON.parse(event.requiredRoles)[0].agreedRate, 10);
  assert.equal(Number(event.totalCost), 654); assert.equal(Number(event.totalRevenue), 808.9);
  assert.equal(Number(event.taxAmount), 98.9); assert.equal(Number(event.billableHours), 28);
  assert.equal(eventCostSummary(event).staffSale, 280); assert.equal(eventCostSummary(event).staffCost, 224);
  assert.equal(buildClientFinancialSummary({ events: [event] })[0].pendingBilling, 808.9);
  assert.deepEqual(event.assignments.map((row) => Number(row.hourlyRate)), [8, 8]);
  assert.deepEqual(event.assignments.map((row) => staffAssignmentPaymentTotal(row, event)), [112, 112]);
  const reopened = await request(`/services/${event.id}`);
  assert.equal(Number(reopened.totalRevenue), 808.9); assert.equal(eventCostSummary(reopened).netSale, 710);
});

test('HTTP existing event tariff is stable when client configuration changes; explicit sale edits do not change staff pay', async () => {
  const event = await createFixture();
  await db.client.update({ where: { id: event.clientId }, data: { roleRates: '[{"role":"Emp.Mesa","rate":99}]' } });
  await request(`/services/${event.id}/workflow/synchronize`, 'POST', { recalculateTotals: true });
  let saved = await request(`/services/${event.id}`);
  assert.equal(eventCostSummary(saved).staffSale, 280); assert.equal(Number(saved.totalRevenue), 808.9);
  await request(`/services/${event.id}`, 'PUT', { requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 12 }] });
  saved = await request(`/services/${event.id}`);
  assert.equal(eventCostSummary(saved).staffSale, 336); assert.equal(Number(saved.totalRevenue), 864.9);
  assert.deepEqual(saved.assignments.map((row) => Number(row.hourlyRate)), [8, 8]);
  await request(`/assignments/${saved.assignments[0].id}`, 'PUT', { hourlyRate: 7 });
  saved = await request(`/services/${event.id}`);
  assert.equal(eventCostSummary(saved).staffCost, 210); assert.equal(eventCostSummary(saved).staffSale, 336);
  assert.equal(Number(saved.totalRevenue), 864.9);
});

test('HTTP sale price edits preserve existing pending/partial receipts and still reject receipt erasure', async () => {
  for (const billingStatus of ['pending', 'partial70']) {
    const event = await createFixture();
    await db.event.update({ where: { id: event.id }, data: { billingStatus, signaledAmount: 100, paidAmount: 200,
      signaledAt: billingStatus === 'pending' ? null : new Date('2026-10-01'),
      remainingPaymentDate: new Date('2026-10-20'), billingPaymentDate: new Date('2026-10-02') } });
    const fields = ['billingStatus', 'signaledAmount', 'paidAmount', 'signaledAt', 'remainingPaymentDate', 'billingPaymentDate'];
    const receipts = (row) => Object.fromEntries(fields.map((field) => [field, row[field]]));
    const before = receipts(await db.event.findUnique({ where: { id: event.id } }));
    await request(`/services/${event.id}`, 'PUT', { requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 12 }] });
    let persisted = await db.event.findUnique({ where: { id: event.id } });
    assert.deepEqual(receipts(persisted), before); assert.equal(Number(persisted.totalRevenue), 864.9);
    await request(`/services/${event.id}`, 'PUT', { staffVatRateSnapshot: 23 });
    persisted = await db.event.findUnique({ where: { id: event.id } });
    assert.deepEqual(receipts(persisted), before); assert.equal(Number(persisted.totalRevenue), 942.18);
    const blocked = await fetch(`${base}/services/${event.id}`, { method: 'PUT', headers,
      body: JSON.stringify({ paidAmount: 0, signaledAmount: 0 }) });
    assert.equal(blocked.status, 422); assert.match((await blocked.json()).message, /recebimentos posteriores/);
    assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), persisted);
  }
});

test('HTTP partner margin and separate VAT persist once; issued invoice protection preserves commercial totals', async () => {
  const event = await createFixture(23);
  assert.equal(Number(event.totalRevenue), 873.3); assert.equal(Number(event.taxAmount), 163.3);
  await request(`/services/${event.id}/external-costs/partner`, 'PUT', { updatedAt: event.updatedAt,
    cost: { id: 'partner', type: 'Aluguer', supplier: 'alugaqui', costAmount: 430, marginPercent: 20, vatType: 'standard_23' } });
  let saved = await request(`/services/${event.id}`);
  assert.equal(Number(saved.totalRevenue), 979.08); assert.equal(Number(saved.taxAmount), 183.08);
  assert.equal(eventCostSummary(saved).partnerSale, 516); assert.equal(eventCostSummary(saved).staffSale, 280);
  assert.deepEqual(saved.assignments.map((row) => staffAssignmentPaymentTotal(row, saved)), [112, 112]);
  const invoice = await db.invoice.create({ data: { number: 'FIC-QA-LOCK', eventId: event.id, clientId: event.clientId,
    issueDate: new Date('2026-10-16'), status: 'issued', total: 979.08 } });
  const before = { revenue: saved.totalRevenue, tax: saved.taxAmount, roles: saved.requiredRoles };
  const blocked = await fetch(`${base}/services/${event.id}`, { method: 'PUT', headers,
    body: JSON.stringify({ requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 20 }] }) });
  assert.equal(blocked.status, 409);
  await request(`/services/${event.id}/workflow/synchronize`, 'POST', { recalculateTotals: true });
  saved = await request(`/services/${event.id}`);
  assert.deepEqual({ revenue: saved.totalRevenue, tax: saved.taxAmount, roles: saved.requiredRoles }, before);
  assert.deepEqual(await db.invoice.findUnique({ where: { id: invoice.id } }), invoice);
});

async function dynamicFixture({ plannedOnly = false, vat = 0, minimum = 0 } = {}) {
  const client = await db.client.create({ data: { name: `Dynamic QA ${++sequence}`, billingMethod: 'per_event',
    paymentTerm: 'days_15', roleRates: '[{"role":"Emp.Mesa","rate":10},{"role":"Bar","rate":14}]', minimumHours: minimum } });
  const event = await request('/services', 'POST', { name: `Dynamic event ${sequence}`, clientId: client.id, date: '2026-10-16',
    startTime: '18:00', endTime: '00:00', status: 'to_validate_client', statusMode: 'manual', vatRateSnapshot: vat,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }], externalCosts: [{ id: 'partner', type: 'Aluguer', supplier: 'QA',
      costAmount: 450, marginPercent: 10, vatType: 'standard_23' }] });
  const collaborator = await newCollaborator();
  const assignment = await request('/assignments', 'POST', { eventId: event.id, collaboratorId: collaborator.id,
    role: 'Emp.Mesa', status: 'confirmed', assignmentDate: '2026-10-16', plannedCheckIn: '18:00', plannedCheckOut: '00:00',
    hourlyRate: 8, ...(!plannedOnly ? { checkIn: '18:00', checkOut: '00:00', validationStatus: 'staff_accepted' } : {}) });
  return { event: await request(`/services/${event.id}`), assignment };
}
async function newCollaborator() {
  return db.collaborator.create({ data: { name: `Dynamic person ${++sequence}`,
    email: `dynamic-${sequence}@example.test`, hourlyRate: 8 } });
}
async function patchAssignment(row, data) { return request(`/assignments/${row.id}`, 'PUT', data); }
async function assertPersisted(id, hours, staffCost, { vat = 0, staffSale = hours * 10 } = {}) {
  // Check storage BEFORE GET: a read must not hide a missing mutation recalculation.
  const persisted = await db.event.findUnique({ where: { id } });
  const revenue = Number((staffSale * (1 + vat / 100) + 608.85).toFixed(2));
  assert.equal(Number(persisted.billableHours), hours, 'persisted billable hours');
  assert.equal(Number(persisted.totalRevenue), revenue, 'persisted client total');
  assert.equal(Number(persisted.totalCost), staffCost + 450, 'persisted Staff + partner cost');
  const detail = await request(`/services/${id}`);
  const list = (await request('/services')).find((row) => row.id === id);
  const summary = eventCostSummary(detail);
  assert.equal(summary.staffSale, staffSale); assert.equal(summary.staffCost, staffCost);
  assert.equal(summary.partnerCost, 450); assert.equal(summary.partnerSale, 495);
  assert.equal(summary.revenue, revenue);
  assert.equal(summary.tax, Number((staffSale * vat / 100 + 113.85).toFixed(2)));
  assert.equal(Number(list.totalRevenue), revenue);
  assert.equal(buildClientFinancialSummary({ events: [list] })[0].pendingBilling, revenue);
  assert.equal(detail.assignments.reduce((sum, row) => sum + staffAssignmentPaymentTotal(row, detail), 0), staffCost);
  assert.equal(detail.externalCosts, persisted.externalCosts);
  return detail;
}

test('HTTP dynamic hours: all 20 requested mutation scenarios persist before read and agree across Costs/Finance', async (t) => {
  await t.test('1 add collaborator / 16 add Staff after event creation', async (subtest) => {
    const { event, assignment } = await dynamicFixture();
    const collaborator = await newCollaborator();
    await request('/assignments', 'POST', { eventId: event.id, collaboratorId: collaborator.id, role: 'Emp.Mesa',
      status: 'confirmed', assignmentDate: '2026-10-16', checkIn: '18:00', checkOut: '00:00', hourlyRate: 8,
      validationStatus: 'staff_accepted' });
    await assertPersisted(event.id, 12, 96);
    await subtest.test('2 remove collaborator', async () => {
      await request(`/assignments/${assignment.id}`, 'DELETE'); await assertPersisted(event.id, 6, 48);
    });
  });
  await t.test('3 substitute collaborator without duplicating hours or resetting client price', async () => {
    const { event, assignment } = await dynamicFixture(); const replacement = await newCollaborator();
    await patchAssignment(assignment, { collaboratorId: replacement.id }); await assertPersisted(event.id, 6, 48);
    assert.equal(await db.eventAssignment.count({ where: { eventId: event.id } }), 1);
  });
  for (const [label, changes, hours] of [
    ['4 planned entry', { plannedCheckIn: '17:00' }, 7],
    ['5 planned exit', { plannedCheckOut: '02:00' }, 8],
  ]) await t.test(label, async () => {
    const { event, assignment } = await dynamicFixture({ plannedOnly: true });
    await patchAssignment(assignment, changes); await assertPersisted(event.id, hours, hours * 8);
  });
  for (const [label, changes, hours] of [
    ['6 executed entry', { checkIn: '17:00' }, 7],
    ['7 finishes later', { checkOut: '02:00' }, 8],
    ['8 finishes earlier', { checkOut: '23:00' }, 5],
    ['9 before validation including obsolete derived numbers', { checkOut: '02:20', clientRealHours: 14, clientBillableHours: 6 }, 8.5],
  ]) await t.test(label, async () => {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, changes); await assertPersisted(event.id, hours, hours * 8);
    const saved = await db.eventAssignment.findUnique({ where: { id: assignment.id } });
    assert.equal(Number(saved.clientRealHours), hours); assert.equal(Number(saved.clientBillableHours), hours);
  });
  await t.test('10 after validation / 14 validate / 15 reopen, change and validate again', async () => {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, { clientCheckIn: '18:00', clientCheckOut: '01:30',
      validatedCheckIn: '18:00', validatedCheckOut: '01:30', validationStatus: 'validated' });
    await request(`/services/${event.id}/workflow/finalize`, 'POST', {}); await assertPersisted(event.id, 7.5, 60);
    await request(`/services/${event.id}/workflow/reopen`, 'POST', { assignmentIds: [assignment.id] });
    await patchAssignment(assignment, { clientCheckOut: '02:00', validatedCheckIn: null, validatedCheckOut: null });
    await assertPersisted(event.id, 8, 64);
    await patchAssignment(assignment, { validatedCheckIn: '18:00', validatedCheckOut: '02:00', validationStatus: 'validated' });
    await request(`/services/${event.id}/workflow/finalize`, 'POST', {}); await assertPersisted(event.id, 8, 64);
  });
  await t.test('11 copy Staff to Client through bulk update', async () => {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, { checkOut: '02:00' });
    await request('/assignments/bulk', 'PUT', { updates: [{ id: assignment.id,
      data: { clientCheckIn: '18:00', clientCheckOut: '02:00', validationStatus: 'staff_accepted' } }] });
    await assertPersisted(event.id, 8, 64);
  });
  await t.test('12 Excel preview and commit use imported clocks instead of obsolete validated clocks', async () => {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, { clientCheckIn: '18:00', clientCheckOut: '00:00',
      validatedCheckIn: '18:00', validatedCheckOut: '00:00', validationStatus: 'validated' });
    const source = await request(`/services/${event.id}`);
    const person = source.assignments[0].collaborator;
    const preview = buildImportPreview([{ rowNumber: 2, sessionName: source.name, collaboratorName: person.name,
      eventDate: '2026-10-16', category: 'Emp.Mesa', clientCheckIn: '18:00', clientCheckOut: '01:30' }], {
      services: [source], collaborators: [person], mappings: [{ field: 'session', externalValue: source.name, internalValue: String(source.id) }],
    });
    assert.equal(preview.rows[0].assignmentId, assignment.id);
    assert.equal(preview.rows[0].clientRealHours, 7.5); assert.equal(preview.rows[0].clientBillableHours, 7.5);
    const result = await request('/time-validation-imports/commit', 'POST', { rows: preview.rows });
    assert.equal(result.imported, 1); await assertPersisted(event.id, 7.5, 60);
    assert.equal((await db.eventAssignment.findUnique({ where: { id: assignment.id } })).validatedCheckOut, null);
  });
  await t.test('13 manual Client correction overrides Staff clocks, not the billing minimum', async () => {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, { checkOut: '02:00', clientCheckIn: '18:00', clientCheckOut: '01:30' });
    await assertPersisted(event.id, 7.5, 60);
    const saved = await db.eventAssignment.findUnique({ where: { id: assignment.id } });
    assert.equal(Number(saved.hoursWorked), 8); assert.equal(Number(saved.clientRealHours), 7.5);
  });
  await t.test('17 Staff and partner costs / 20 independent VAT rates', async () => {
    const { event, assignment } = await dynamicFixture({ vat: 23 });
    await patchAssignment(assignment, { checkOut: '02:00' }); await assertPersisted(event.id, 8, 64, { vat: 23 });
  });
  await t.test('18 different roles and client/Staff hourly rates', async () => {
    const { event, assignment } = await dynamicFixture();
    await request(`/services/${event.id}`, 'PUT', { requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 10 }, { role: 'Bar', qty: 1, agreedRate: 14 }] });
    const collaborator = await newCollaborator();
    await request('/assignments', 'POST', { eventId: event.id, collaboratorId: collaborator.id, role: 'Bar', hourlyRate: 9,
      assignmentDate: '2026-10-16', status: 'confirmed', checkIn: '18:00', checkOut: '23:00', validationStatus: 'staff_accepted' });
    await patchAssignment(assignment, { checkOut: '01:00' });
    await assertPersisted(event.id, 12, 101, { staffSale: 140 });
  });
  await t.test('19 Staff adjustments before Staff VAT; client sale unaffected', async () => {
    const { event, assignment } = await dynamicFixture();
    await db.collaborator.update({ where: { id: assignment.collaboratorId }, data: { includeVat: true } });
    await patchAssignment(assignment, { paymentAdjustment: -8, checkOut: '02:00' });
    await assertPersisted(event.id, 8, 68.88);
  });
  await t.test('billing minimum remains distinct from payroll and real hours', async () => {
    const { event, assignment } = await dynamicFixture({ minimum: 4.5 });
    await patchAssignment(assignment, { checkOut: '20:00' });
    const saved = await assertPersisted(event.id, 4.5, 16); assert.equal(Number(saved.realHours), 2);
  });
});

test('exact FIC 16/10 regression: obsolete 14+9+14 is repaired and persisted, while correct 6+9+9 stays 24', async () => {
  const { event, assignment } = await dynamicFixture();
  await db.event.update({ where: { id: event.id }, data: { name: 'FIC Restaurante - FIXOS', requiredRoles: '[{"role":"Emp.Mesa","qty":3,"agreedRate":10}]',
    realHours: 37, billableHours: 24, totalCost: 642, totalRevenue: 848.85, taxAmount: 113.85 } });
  await db.eventAssignment.update({ where: { id: assignment.id }, data: { clientRealHours: 14, clientBillableHours: 6 } });
  for (const cached of [9, 14]) {
    const person = await newCollaborator();
    await db.eventAssignment.create({ data: { eventId: event.id, collaboratorId: person.id, role: 'Emp.Mesa', status: 'confirmed',
      assignmentDate: new Date('2026-10-16'), plannedCheckIn: '10:00', plannedCheckOut: '00:00', checkIn: '17:30', checkOut: '02:20',
      hourlyRate: 8, hoursWorked: 9, staffPayableHours: 9, clientRealHours: cached, clientBillableHours: 9, validationStatus: 'staff_accepted' } });
  }
  const saved = await request(`/services/${event.id}`);
  assert.equal(Number(saved.realHours), 24); await assertPersisted(event.id, 24, 192);
  assert.deepEqual(saved.assignments.map((row) => Number(row.clientRealHours)).sort((a, b) => a - b), [6, 9, 9]);
  const persisted = await db.event.findUnique({ where: { id: event.id } });
  await request(`/services/${event.id}`);
  assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), persisted, 'second read makes no additional writes');
});

test('stale aggregates repair on list read, including prepaid events, but issued invoices remain immutable', async () => {
  for (const locked of ['', 'invoice', 'paid']) {
    const { event, assignment } = await dynamicFixture();
    await db.eventAssignment.update({ where: { id: assignment.id }, data: { checkOut: '02:00' } });
    if (locked === 'paid') await db.event.update({ where: { id: event.id }, data: { billingStatus: 'paid' } });
    if (locked === 'invoice') await db.invoice.create({ data: { number: `DYNAMIC-${event.id}`, eventId: event.id,
      clientId: event.clientId, issueDate: new Date('2026-10-16'), status: 'issued', total: 668.85 } });
    const before = await db.event.findUnique({ where: { id: event.id } });
    const rows = await request('/services'); assert.ok(rows.some((row) => row.id === event.id));
    if (locked === 'invoice') assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), before);
    else {
      const saved = await assertPersisted(event.id, 8, 64);
      if (locked === 'paid') assert.equal(clientPaymentSummary(saved).received, Number(before.totalRevenue));
    }
  }
});

test('QR checkout and financial update commit atomically, and a failing recalculation rolls back punch/log', async () => {
  for (const fail of [false, true]) {
    const { event, assignment } = await dynamicFixture();
    await patchAssignment(assignment, { checkOut: null });
    const qr = await db.qrCheckCode.findUnique({ where: { assignmentId: assignment.id } }); assert.ok(qr);
    const logsBefore = await db.qrCheckLog.count({ where: { assignmentId: assignment.id } });
    const punch = () => registerPublicQr(db, qr.token, 'check_out', { now: new Date('2026-10-16T22:00:00Z'),
      afterWrite: async (tx, code) => {
        await synchronizeEventWorkflow(tx, code.eventId, { recalculateTotals: true });
        if (fail) throw new Error('QA rollback');
      } });
    if (fail) {
      await assert.rejects(punch, /QA rollback/);
      assert.equal((await db.eventAssignment.findUnique({ where: { id: assignment.id } })).checkOut, null);
      assert.equal(await db.qrCheckLog.count({ where: { assignmentId: assignment.id } }), logsBefore);
    } else {
      await punch(); await assertPersisted(event.id, 5, 40);
      assert.equal(await db.qrCheckLog.count({ where: { assignmentId: assignment.id } }), logsBefore + 1);
    }
  }
});

test('Staff VAT enable/disable persists, updates billable changes and never changes Staff payroll or partner VAT', async () => {
  let event = await createFixture(0);
  const assignments = await db.eventAssignment.findMany({ where: { eventId: event.id }, orderBy: { id: 'asc' } });
  const check = async (revenue, tax, hours = 28) => {
    const persisted = await db.event.findUnique({ where: { id: event.id } });
    assert.equal(Number(persisted.totalRevenue), revenue); assert.equal(Number(persisted.taxAmount), tax);
    event = await request(`/services/${event.id}`);
    assert.equal(Number(event.billableHours), hours);
    assert.equal(buildClientFinancialSummary({ events: [event] })[0].pendingBilling, revenue);
    assert.equal(clientPaymentSummary(event).outstanding, revenue);
    const reference = prepaymentReferenceAmounts(revenue);
    assert.equal(Math.round((reference.seventy + reference.thirty) * 100), Math.round(revenue * 100));
    assert.equal(eventCostSummary(event).partnerSale, 430);
  };
  await request(`/services/${event.id}`, 'PUT', { staffVatRateSnapshot: 23 });
  await check(873.3, 163.3);
  assert.deepEqual(await db.eventAssignment.findMany({ where: { eventId: event.id }, orderBy: { id: 'asc' } }), assignments);
  assert.deepEqual(event.assignments.map((row) => staffAssignmentPaymentTotal(row, event)), [112, 112]);
  await request(`/services/${event.id}`, 'PUT', { staffVatRateSnapshot: 0 }); await check(808.9, 98.9);
  await request(`/services/${event.id}`, 'PUT', { staffVatRateSnapshot: 23 });
  await request(`/assignments/${assignments[0].id}`, 'PUT', { clientCheckOut: '01:00' });
  await check(885.6, 165.6, 29);
  await request(`/services/${event.id}`, 'PUT', { requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 12 }] });
  await check(956.94, 178.94, 29);
  assert.equal(Number(event.assignments[0].hourlyRate), 8);
});

test('Staff VAT and external deletion preserve receipts and block totals below received amounts, including ordinary form saves', async () => {
  let event = await createFixture(0);
  await db.event.update({ where: { id: event.id }, data: { billingStatus: 'partial70', signaledAmount: 100,
    paidAmount: 100, signaledAt: new Date('2026-10-01') } });
  await request(`/services/${event.id}`, 'PUT', { staffVatRateSnapshot: 23 });
  event = await request(`/services/${event.id}`);
  await request(`/services/${event.id}/external-costs/partner`, 'DELETE', { updatedAt: event.updatedAt });
  event = await request(`/services/${event.id}`);
  assert.equal(Number(event.totalRevenue), 344.4); assert.equal(Number(event.taxAmount), 64.4);
  assert.equal(Number(event.totalCost), 224); assert.equal(Number(event.paidAmount), 100);
  assert.equal(clientPaymentSummary(event).outstanding, 244.4); assert.equal(event.billingStatus, 'partial70');
  assert.equal(JSON.parse(event.externalCosts).length, 0);
  await db.event.update({ where: { id: event.id }, data: { paidAmount: 300, signaledAmount: 300 } });
  const before = await db.event.findUnique({ where: { id: event.id } });
  const blocked = await fetch(`${base}/services/${event.id}`, { method: 'PUT', headers, body: JSON.stringify({ staffVatRateSnapshot: 0 }) });
  assert.equal(blocked.status, 409); assert.match((await blocked.json()).message, /inferior ao valor já recebido/);
  assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), before);
  event = await createFixture(0);
  await db.event.update({ where: { id: event.id }, data: { billingStatus: 'partial70', paidAmount: 600, signaledAmount: 600 } });
  for (const form of [false, true]) {
    const current = await db.event.findUnique({ where: { id: event.id } });
    const response = await fetch(`${base}/services/${event.id}${form ? '' : '/external-costs/partner'}`, {
      method: form ? 'PUT' : 'DELETE', headers, body: JSON.stringify(form ? { externalCosts: [] } : { updatedAt: current.updatedAt }),
    });
    assert.equal(response.status, 409); assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), current);
  }
});

test('Staff VAT and deletion cannot bypass direct/grouped invoices, paid states or authentication', async () => {
  for (const protection of ['invoiced', 'invoice', 'grouped']) {
    const event = await createFixture(0);
    if (['invoiced', 'paid'].includes(protection)) await db.event.update({ where: { id: event.id }, data: { billingStatus: protection } });
    else await db.invoice.create({ data: { number: `VAT-LOCK-${event.id}`, clientId: event.clientId,
      ...(protection === 'invoice' ? { eventId: event.id } : { eventIds: JSON.stringify([event.id]) }),
      status: 'issued', issueDate: new Date('2026-10-16'), total: 808.9 } });
    const before = await db.event.findUnique({ where: { id: event.id } });
    const patch = await fetch(`${base}/services/${event.id}`, { method: 'PUT', headers, body: JSON.stringify({ staffVatRateSnapshot: 23 }) });
    const deletion = await fetch(`${base}/services/${event.id}/external-costs/partner`, { method: 'DELETE', headers, body: JSON.stringify({ updatedAt: before.updatedAt }) });
    assert.equal(patch.status, 409); assert.equal(deletion.status, 409);
    assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), before);
  }
  const event = await createFixture();
  const noAuth = await fetch(`${base}/services/${event.id}/external-costs/partner`, { method: 'DELETE' }); assert.equal(noAuth.status, 401);
});

test('budget conversion carries existing Staff VAT and leaves partner taxation independent', async () => {
  for (const vatRate of [0, 23]) {
    const client = await db.client.create({ data: { name: `Budget VAT ${++sequence}` } });
    const draft = buildBudgetConversionDraft({ reference: `BUDGET-VAT-${sequence}`, eventName: `Budget VAT ${sequence}`,
      eventDate: '2026-10-16', startTime: '10:00', endTime: '00:00', vatRate,
      categories: JSON.stringify([{ role: 'Emp.Mesa', qty: 2, rate: 10, start: '10:00', end: '00:00' }]),
      externalCosts: JSON.stringify([{ id: 'budget-partner', type: 'Aluguer', costAmount: 430, marginPercent: 0, vatType: 'standard_23' }]) });
    const payload = buildEventPayloadFromBudgetConversion(draft, client.id);
    assert.equal(payload.staffVatRateSnapshot, vatRate); assert.equal(payload.vatRateSnapshot, vatRate);
    const event = await request('/services', 'POST', payload);
    const saved = await db.event.findUnique({ where: { id: event.id } });
    assert.equal(Number(saved.staffVatRateSnapshot), vatRate); assert.match(saved.notes, /BUDGET_REF:/);
    assert.equal(Number(saved.totalRevenue), vatRate ? 873.3 : 808.9);
    assert.equal(Number(saved.taxAmount), vatRate ? 163.3 : 98.9);
    assert.equal(JSON.parse(saved.externalCosts)[0].taxAmount, 98.9);
  }
});

async function advanceFixture({ vat = 0, settle = true, paidDate = '2026-11-08' } = {}) {
  const client = await db.client.create({ data: { name: `Globo QA ${++sequence}`, billingMethod: 'per_event',
    roleRates: '[{"role":"Emp.Mesa","rate":30}]' } });
  const created = await request('/services', 'POST', { name: 'Corporate - Globo de prata QA', clientId: client.id,
    date: '2026-11-15', startTime: '10:00', endTime: '16:00', statusMode: 'automatic', vatRateSnapshot: vat,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 30 }],
    externalCosts: [{ id: 'advance-partner', type: 'Aluguer', supplier: 'Parceiro QA', costAmount: 446.46, vatType: 'exempt' }] });
  for (let index = 0; index < 3; index += 1) {
    const person = await newCollaborator();
    await request('/assignments', 'POST', { eventId: created.id, collaboratorId: person.id, role: 'Emp.Mesa', status: 'confirmed',
      assignmentDate: '2026-11-15', plannedCheckIn: '10:00', plannedCheckOut: '16:00', hourlyRate: 8 });
  }
  let event = await request(`/services/${created.id}`);
  const initialTotal = Number(event.totalRevenue), reference = prepaymentReferenceAmounts(initialTotal);
  await request(`/services/${event.id}`, 'PUT', buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'partial70',
    signaledAmount: String(reference.seventy), signaledAt: '2026-10-15', remainingPaymentDate: '2026-11-08' }, event));
  event = await request(`/services/${event.id}`);
  if (settle) {
    await request(`/services/${event.id}`, 'PUT', buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'paid',
      remainingReceived: String(reference.thirty), billingPaymentDate: paidDate }, event));
    event = await request(`/services/${event.id}`);
  }
  return { event, initialTotal, reference };
}

async function advanceHours(event, { firstIn = '10:00', secondOut = '16:00', clientOnly = false, validated = false } = {}) {
  for (const [index, row] of event.assignments.entries()) {
    const checkIn = index === 0 ? firstIn : '10:00', checkOut = index === 1 ? secondOut : '16:00';
    await patchAssignment(row, { checkIn: clientOnly ? '10:00' : checkIn, checkOut: clientOnly ? '16:00' : checkOut,
      clientCheckIn: checkIn, clientCheckOut: checkOut,
      ...(validated ? { validatedCheckIn: checkIn, validatedCheckOut: checkOut, validationStatus: 'validated' }
        : { validationStatus: 'staff_accepted' }) });
  }
  return request(`/services/${event.id}`);
}

test('advance payment: 20 requested scenarios keep execution, receipts and final invoicing independent', async (t) => {
  await t.test('1 only 70% received leaves the actual remainder outstanding', async () => {
    const { event, reference } = await advanceFixture({ settle: false });
    assert.equal(clientPaymentSummary(event).received, 690.52);
    assert.equal(clientPaymentSummary(event).outstanding, reference.thirty);
    assert.notEqual(event.status, 'finalized');
  });
  for (const [label, paidDate] of [['2 full payment before event', '2026-11-14'], ['3 full payment one week before event', '2026-11-08']]) {
    await t.test(label, async () => {
      const { event } = await advanceFixture({ paidDate });
      assert.equal(Number(event.paidAmount), 986.46); assert.equal(event.billingStatus, 'paid');
      assert.equal(event.billingPaymentDate.slice(0, 10), paidDate); assert.notEqual(event.status, 'finalized');
    });
  }
  await t.test('4 zero outstanding is forecast received, not operational/financial closure', async () => {
    const { event } = await advanceFixture(); const summary = clientPaymentSummary(event);
    assert.equal(summary.outstanding, 0);
    assert.equal(clientPaymentAssessment(event, summary).label, 'Previsto totalmente recebido');
    assert.equal(await db.invoice.count({ where: { eventId: event.id } }), 0);
  });
  for (const [label, options, hours, delta] of [
    ['5 exact planned hours', {}, 18, 0],
    ['6 more Staff hours', { firstIn: '09:30', secondOut: '16:30' }, 19, 30],
    ['7 fewer Staff hours', { firstIn: '11:00' }, 17, -30],
    ['8 hours changed before validation', { firstIn: '09:30' }, 18.5, 15],
    ['9 hours changed during validation', { firstIn: '09:30', validated: true }, 18.5, 15],
    ['10 Client clocks differ from plan and Staff', { firstIn: '09:30', secondOut: '16:30', clientOnly: true, validated: true }, 19, 30],
  ]) await t.test(label, async () => {
    const { event, initialTotal } = await advanceFixture();
    const before = readClientPaymentRecord(event.clientPaymentRecord);
    const saved = await advanceHours(event, options);
    assert.equal(Number(saved.billableHours), hours); assert.equal(Number(saved.totalRevenue), initialTotal + delta);
    assert.equal(clientPaymentSummary(saved).received, initialTotal);
    assert.equal(clientPaymentSummary(saved).outstanding, Math.max(0, delta));
    assert.equal(clientPaymentAssessment(saved, clientPaymentSummary(saved)).excess, Math.max(0, -delta));
    assert.equal(Number(saved.signaledAmount), 690.52);
    assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord), before);
    assert.equal(saved.billingPaymentDate, event.billingPaymentDate);
  });
  for (const [label, total, outstanding, excess] of [
    ['11 final higher', 1050, 63.54, 0], ['12 final equal', 986.46, 0, 0], ['13 final lower', 950, 0, 36.46],
  ]) await t.test(label, () => {
    const event = { totalRevenue: total, paidAmount: 986.46, signaledAmount: 690.52, billingStatus: 'paid' };
    const summary = clientPaymentSummary(event);
    assert.equal(summary.received, 986.46); assert.equal(summary.outstanding, outstanding);
    assert.equal(clientPaymentAssessment(event, summary).excess, excess);
  });
  await t.test('14 additional receipt after validation appends to signal and remaining, with double-submit protection', async () => {
    const { event } = await advanceFixture();
    let saved = await advanceHours(event, { firstIn: '09:30', secondOut: '16:30', validated: true });
    await request(`/services/${event.id}/workflow/finalize`, 'POST', {});
    saved = await request(`/services/${event.id}`);
    const payload = { updatedAt: saved.updatedAt, amount: 30, receivedAt: '2026-11-16' };
    saved = await request(`/services/${event.id}/client-payment/receive-additional`, 'POST', payload);
    assert.equal(Number(saved.paidAmount), 1016.46); assert.equal(clientPaymentSummary(saved).outstanding, 0);
    const record = readClientPaymentRecord(saved.clientPaymentRecord);
    assert.deepEqual(record.entries.map((entry) => [entry.type, entry.amount]), [['signal', 690.52], ['remaining', 295.94], ['adjustment', 30]]);
    assert.equal(record.expectedTotal, 986.46);
    const duplicate = await fetch(`${base}/services/${event.id}/client-payment/receive-additional`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(duplicate.status, 409); assert.equal(Number((await db.event.findUnique({ where: { id: event.id } })).paidAmount), 1016.46);
  });
  await t.test('15 existing payment amounts/dates and history survive reopening and importing Client Excel', async () => {
    const { event } = await advanceFixture(); const saved = await advanceHours(event, { validated: true });
    await request(`/services/${event.id}/workflow/finalize`, 'POST', {});
    await request(`/services/${event.id}/workflow/reopen`, 'POST', { assignmentIds: [saved.assignments[0].id] });
    const person = saved.assignments[0].collaborator;
    const preview = buildImportPreview([{ rowNumber: 2, sessionName: saved.name, collaboratorName: person.name,
      eventDate: '2026-11-15', category: 'Emp.Mesa', clientCheckIn: '09:30', clientCheckOut: '16:00' }], {
      services: [saved], collaborators: [person], mappings: [{ field: 'session', externalValue: saved.name, internalValue: String(saved.id) }],
    });
    assert.equal((await request('/time-validation-imports/commit', 'POST', { rows: preview.rows })).imported, 1);
    const final = await request(`/services/${event.id}`);
    assert.equal(Number(final.paidAmount), 986.46); assert.equal(clientPaymentSummary(final).outstanding, 15);
    assert.equal(final.billingPaymentDate, event.billingPaymentDate);
    assert.equal(final.clientPaymentRecord, event.clientPaymentRecord);
  });
  await t.test('16 selecting signal after settlement does not recreate the already paid 30%', async () => {
    const { event } = await advanceFixture();
    const payload = buildClientPaymentPayload({ ...clientPaymentDraft(event), billingStatus: 'partial70' }, event);
    assert.equal(payload.paidAmount, 986.46);
    const saved = await request(`/services/${event.id}`, 'PUT', payload);
    assert.equal(clientPaymentSummary(saved).outstanding, 0);
  });
  for (const [label, vat] of [['17 Staff with VAT', 23], ['18 Staff without VAT', 0]]) await t.test(label, async () => {
    const { event, initialTotal } = await advanceFixture({ vat });
    const saved = await advanceHours(event, { firstIn: '09:30', secondOut: '16:30' });
    const delta = vat ? 36.9 : 30;
    assert.equal(Number(saved.totalRevenue), Number((initialTotal + delta).toFixed(2)));
    assert.equal(clientPaymentSummary(saved).outstanding, delta);
  });
  await t.test('19 Staff-to-Client copy keeps partner costs and receipts independent', async () => {
    const { event } = await advanceFixture();
    await request('/assignments/bulk', 'PUT', { updates: event.assignments.map((row, index) => ({ id: row.id,
      data: { checkIn: index ? '10:00' : '09:30', checkOut: '16:00', clientCheckIn: index ? '10:00' : '09:30', clientCheckOut: '16:00', validationStatus: 'validated' } })) });
    const saved = await request(`/services/${event.id}`);
    assert.equal(saved.externalCosts, event.externalCosts); assert.equal(Number(saved.paidAmount), 986.46);
    assert.equal(clientPaymentSummary(saved).outstanding, 15);
  });
  await t.test('20 actual issued invoices still block hours, Client copies, VAT and additional receipt shortcuts', async () => {
    for (const grouped of [false, true]) {
      const { event } = await advanceFixture();
      await db.invoice.create({ data: { number: `ADVANCE-ISSUED-${event.id}`, clientId: event.clientId, status: 'issued',
        issueDate: new Date('2026-11-16'), total: 986.46, ...(grouped ? { eventIds: JSON.stringify([event.id]) } : { eventId: event.id }) } });
      const before = await db.event.findUnique({ where: { id: event.id } });
      const blocked = await fetch(`${base}/assignments/${event.assignments[0].id}`, { method: 'PUT', headers, body: JSON.stringify({ clientCheckOut: '17:00' }) });
      assert.equal(blocked.status, 409);
      const receipt = await fetch(`${base}/services/${event.id}/client-payment/receive-additional`, { method: 'POST', headers,
        body: JSON.stringify({ amount: 30, receivedAt: '2026-11-16', updatedAt: event.updatedAt }) });
      assert.equal(receipt.status, 409);
      assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), before);
    }
  });
});
