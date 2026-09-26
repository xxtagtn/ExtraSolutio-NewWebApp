import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { readCommunicationPage } from './communicationPage.js';
import { readQrCodesPage, readRelevantQrEvents } from './qrCodesPage.js';
import { readNotificationOverview } from './notificationOverview.js';
import { buildCommunicationCenter, communicationSummary } from '../../src/utils/communicationCenter.js';
import { buildLayoutNotifications, layoutPaymentReminders } from '../../src/utils/layoutNotifications.js';
import { eventStartInstant } from '../utils/eventTime.js';

const directory = mkdtempSync(join(tmpdir(), 'es-communication-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl, log: [{ emit: 'event', level: 'query' }] });
const now = new Date('2026-09-23T08:00:00Z');
process.env.JWT_SECRET = 'communication-test-signing-key-not-for-production';
let queries = [];
db.$on('query', (query) => queries.push(query.query));

before(async () => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(result.stdout);
  sqlite.close();
  await db.collaborator.createMany({ data: [
    { id: 1, name: 'Joao Costa', email: 'joao@example.test', phone: '900000001' },
    { id: 2, name: 'Ana Silva', email: 'ana@example.test', phone: '900000002', birthDate: new Date('1990-09-23'), documentType: 'passport', documentExpiry: new Date('2026-09-01') },
    { id: 3, name: 'Bruno Santos', email: 'bruno@example.test', phone: '900000003' },
  ] });
  await db.event.createMany({ data: [
    { id: 1, name: 'Evento continuo', clientName: 'Cliente A', date: new Date('2026-09-01'), endDate: new Date('2026-09-30'), isContinuous: true, uniform: 'Camisa preta', location: 'Lisboa' },
    { id: 2, name: 'Evento unico', clientName: 'Cliente B', date: new Date('2026-09-24'), startTime: '09:00' },
    { id: 3, name: 'Evento cancelado', date: new Date('2026-09-24'), status: 'cancelled' },
  ] });
  await db.eventAssignment.createMany({ data: Array.from({ length: 63 }, (_, index) => ({
    id: index + 1, eventId: 1, collaboratorId: (index % 3) + 1, role: index % 2 ? 'Mesa' : 'Bar',
    assignmentDate: new Date(`2026-09-${String(21 + index % 3).padStart(2, '0')}`),
    plannedCheckIn: index % 2 ? '10:00' : '11:00', plannedCheckOut: '17:00',
    ...(index < 5 ? { checkIn: '10:05', checkOut: '17:00' } : {}),
  })) });
  await db.eventAssignment.createMany({ data: [
    { id: 70, eventId: 2, collaboratorId: 2, status: 'confirmed' },
    { id: 71, eventId: 2, collaboratorId: 3, status: 'confirmed', assignmentDate: new Date('2026-09-25') },
    { id: 72, eventId: 1, collaboratorId: 1, status: 'confirmed', assignmentDate: new Date('2026-09-22') },
    { id: 73, eventId: 1, collaboratorId: 1, status: 'missed_justified' },
    { id: 74, eventId: 1, collaboratorId: 1, status: 'missed_unjustified' },
    { id: 75, eventId: 1, collaboratorId: 1, status: 'cancelled' },
    { id: 76, eventId: 3, collaboratorId: 1, status: 'assigned' },
  ] });
  await db.communicationLog.createMany({ data: [
    { id: 1, assignmentId: 1, eventId: 1, collaboratorId: 1, type: 'confirmation', status: 'sent', createdAt: new Date('2026-09-20T09:00Z') },
    { id: 2, assignmentId: 1, eventId: 1, collaboratorId: 1, type: 'confirmation', status: 'responded', message: 'Mensagem editada', createdAt: new Date('2026-09-20T10:00Z') },
    { id: 3, assignmentId: 1, eventId: 1, collaboratorId: 1, type: 'reminder_24h', status: 'failed', createdAt: new Date('2026-09-20T11:00Z') },
  ] });
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

test('server pages preserve all current communication rules and hydrate only requested messages', async () => {
  const services = await db.event.findMany({ include: { assignments: { include: { collaborator: true } } } });
  const communicationLogs = await db.communicationLog.findMany();
  const expected = buildCommunicationCenter({ services, communicationLogs }, { today: now, resolveStart: eventStartInstant });
  const actual = [];
  for (let page = 1; page <= 3; page += 1) {
    queries = [];
    const result = await readCommunicationPage(db, { page, pageSize: 25, state: 'all' }, { now });
    assert.equal(result.total, 65);
    assert.ok(result.items.length <= 25);
    assert.deepEqual(result.summary, communicationSummary(expected));
    assert.ok(queries.some((sql) => sql.includes('EventAssignment') && sql.includes('LIMIT')));
    assert.equal(result.items.some((row) => 'collaborator' in row || 'assignments' in row), false);
    actual.push(...result.items);
  }
  assert.deepEqual(actual.map((row) => row.id), expected.map((row) => row.id));
  assert.equal(new Set(actual.map((row) => row.id)).size, actual.length);
  const edited = actual.find((row) => row.assignmentId === 1);
  assert.equal(edited.message, 'Mensagem editada');
  assert.equal(edited.state, 'responded');
  assert.ok(actual.some((row) => row.message.includes('Camisa preta')));
  assert.equal(actual.find((row) => row.assignmentId === 70).state, 'ready');
  assert.equal(actual.find((row) => row.assignmentId === 71).state, 'scheduled');
});

test('filters apply before pagination, including empty results and clearing filters', async () => {
  const result = await readCommunicationPage(db, { page: 2, pageSize: 10, search: 'Ana Silva', eventId: '1', kind: 'confirmation', state: 'open' }, { now });
  assert.equal(result.total, 21);
  assert.equal(result.items.length, 10);
  assert.ok(result.items.every((row) => row.collaboratorName === 'Ana Silva' && row.serviceId === 1));
  const empty = await readCommunicationPage(db, { page: 20, search: 'inexistente' }, { now });
  assert.equal(empty.page, 1);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  const all = await readCommunicationPage(db, { page: 999, pageSize: 25, state: 'all' }, { now });
  assert.equal(all.page, 3);
  assert.equal(all.items.length, 15);
});

test('a status change is reflected immediately and page size is capped', async () => {
  await db.communicationLog.update({ where: { id: 2 }, data: { status: 'confirmed' } });
  const filtered = await readCommunicationPage(db, { search: 'Joao', state: 'confirmed' }, { now });
  assert.deepEqual(filtered.items.map((row) => row.assignmentId), [1]);
  const open = await readCommunicationPage(db, { pageSize: 10000 }, { now });
  assert.equal(open.pageSize, 100);
  assert.equal(open.total, 64);
  assert.equal(open.items.some((row) => row.assignmentId === 1), false);
});

test('QR pages use each assignment day, keep global counters, and never write QR tokens', async () => {
  queries = [];
  const first = await readQrCodesPage(db, 1, { page: 1, pageSize: 10 }, { now });
  const second = await readQrCodesPage(db, 1, { page: 2, pageSize: 10 }, { now });
  assert.equal(first.items.length, 10);
  assert.equal(first.total, 42);
  assert.deepEqual(first.summary, { total: 42, entries: 3, completed: 3 });
  assert.deepEqual(second.summary, first.summary);
  assert.equal(second.items.some((row) => first.items.some((other) => row.id === other.id)), false);
  assert.ok(first.items.every((row) => row.status !== 'cancelled'));
  const days = [...first.items, ...second.items].map((row) => (row.assignmentDate || first.event.date).toISOString());
  assert.deepEqual(days, [...days].sort());
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.equal(await readQrCodesPage(db, 999), null);
});

test('grouped QR pagination keeps every service of a collaborator/day on the same page', async () => {
  const first = await readQrCodesPage(db, 1, { page: 1, pageSize: 1, groupBy: 'collaboratorDay' }, { now });
  const second = await readQrCodesPage(db, 1, { page: 2, pageSize: 1, groupBy: 'collaboratorDay' }, { now });
  const all = await readQrCodesPage(db, 1, { pageSize: 100 }, { now });
  assert.equal(first.total, 2);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 21);
  assert.equal(second.items.length, 21);
  assert.equal(new Set(first.items.map((row) => `${row.collaboratorId}:${row.assignmentDate.toISOString()}`)).size, 1);
  assert.deepEqual(first.summary, all.summary);
  assert.deepEqual(second.summary, all.summary);
  assert.deepEqual([...first.items, ...second.items].map((row) => row.id).sort((a, b) => a - b), all.items.map((row) => row.id).sort((a, b) => a - b));
  const last = await readQrCodesPage(db, 1, { page: 99, pageSize: 1, groupBy: 'collaboratorDay' }, { now });
  assert.equal(last.page, 2);
  assert.deepEqual(last.items, second.items);
});

test('lightweight notifications preserve the existing rules and enforce read permissions', async () => {
  const overview = await readNotificationOverview(db, { role: 'admin' }, { now });
  const inputs = JSON.parse(JSON.stringify({
    services: await db.event.findMany({ include: { assignments: true, client: true } }),
    budgets: await db.budget.findMany(), invoices: await db.invoice.findMany({ include: { client: true } }),
    collaborators: await db.collaborator.findMany(),
  }));
  assert.deepEqual(overview.notifications, buildLayoutNotifications({ ...inputs, now }));
  assert.deepEqual(overview.reminders, layoutPaymentReminders(inputs.services, now).map(({ id, name }) => ({ id, name })));
  queries = [];
  const denied = await readNotificationOverview(db, { role: 'operations', permissions: [] }, { now });
  assert.equal(denied.notifications.total, 0);
  assert.equal(queries.length, 0);
  const restricted = await readNotificationOverview(db, { role: 'operations', permissions: ['collaborators.view'] }, { now });
  assert.equal(restricted.notifications.total, 0);
  assert.equal(queries.length, 0);
});

test('QR endpoint generates only the page and reuses existing tokens without writes on refresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  process.env.DATABASE_URL = datasourceUrl;
  const { qrCodesRouter } = await import('../routes/qrCheckins.js');
  const { prisma } = await import('../prisma.js');
  const route = qrCodesRouter.stack.find((layer) => layer.route?.path === '/events/:eventId').route.stack[0].handle;
  const invoke = (page) => new Promise((resolve, reject) => {
    route({ params: { eventId: '1' }, query: { page, pageSize: 10 }, protocol: 'http', get: () => 'localhost:5177' }, { json: resolve }, reject);
  });
  try {
    const first = await invoke(1);
    assert.equal(first.rows.length, 10);
    assert.equal(first.summary.total, 42);
    assert.equal(await db.qrCheckCode.count(), 10);
    const codes = await db.qrCheckCode.findMany({ orderBy: { id: 'asc' } });
    const refreshed = await invoke(1);
    assert.deepEqual(refreshed.rows.map((row) => row.qrUrl), first.rows.map((row) => row.qrUrl));
    assert.deepEqual(await db.qrCheckCode.findMany({ orderBy: { id: 'asc' } }), codes);
    const second = await invoke(2);
    assert.equal(second.rows.length, 10);
    assert.equal(await db.qrCheckCode.count(), 20);
  } finally {
    await prisma.$disconnect();
  }
});

test('QR visibility updates by individual actual/planned times before pagination, without touching historical data', async () => {
  await db.event.create({ data: { id: 4, name: 'Individual schedules', date: new Date('2026-09-24'), startTime: '18:00', endTime: '23:00' } });
  await db.eventAssignment.createMany({ data: [
    { id: 200, eventId: 4, collaboratorId: 1, plannedCheckIn: '17:00', plannedCheckOut: '22:00' },
    { id: 201, eventId: 4, collaboratorId: 2, plannedCheckIn: '19:00', plannedCheckOut: '23:00' },
    { id: 202, eventId: 4, collaboratorId: 3, assignmentDate: new Date('2026-09-20'), plannedCheckIn: '18:00', plannedCheckOut: '23:00' },
    { id: 203, eventId: 4, collaboratorId: 3, checkIn: '18:10', checkOut: '21:00' },
  ] });
  const before = {
    assignments: await db.eventAssignment.findMany(), events: await db.event.findMany(),
    codes: await db.qrCheckCode.findMany(), logs: await db.qrCheckLog.findMany(),
  };
  queries = [];
  const atStart = await readQrCodesPage(db, 4, { page: 1, pageSize: 1 }, { now: eventStartInstant('2026-09-23', '18:00', 'Europe/Lisbon') });
  assert.deepEqual(atStart.items.map((row) => row.id), [200]);
  assert.equal(atStart.total, 1);
  const afterEnd = { now: eventStartInstant('2026-09-25', '22:30', 'Europe/Lisbon') };
  const page = await readQrCodesPage(db, 4, { page: 99, pageSize: 1 }, afterEnd);
  assert.equal(page.page, 1);
  assert.deepEqual(page.items.map((row) => row.id), [201]);
  assert.equal(page.total, 1);
  assert.ok((await readRelevantQrEvents(db, afterEnd)).some((row) => row.id === '4'));
  const expired = { now: eventStartInstant('2026-09-25', '23:00', 'Europe/Lisbon') };
  assert.equal((await readQrCodesPage(db, 4, {}, expired)).total, 0);
  assert.equal((await readRelevantQrEvents(db, expired)).some((row) => row.id === '4'), false);
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.deepEqual({ assignments: await db.eventAssignment.findMany(), events: await db.event.findMany(), codes: await db.qrCheckCode.findMany(), logs: await db.qrCheckLog.findMany() }, before);
});

test('reminder and QR table resolve the same daily link, schedule and collaborator without duplicate codes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  process.env.DATABASE_URL = datasourceUrl;
  const { qrCodesRouter } = await import('../routes/qrCheckins.js');
  const { prisma } = await import('../prisma.js');
  const invoke = (path, params, query = {}) => new Promise((resolve, reject) => {
    const route = qrCodesRouter.stack.find((layer) => layer.route?.path === path).route.stack[0].handle;
    route({ params, query, protocol: 'https', get: () => 'es.example.test' }, { json: resolve }, reject);
  });
  try {
    await db.eventAssignment.create({ data: { id: 300, eventId: 1, collaboratorId: 2, assignmentDate: new Date('2026-09-23'), plannedCheckIn: '11:00', plannedCheckOut: '17:00', status: 'confirmed', role: 'Mesa' } });
    const task = (await readCommunicationPage(db, { kind: 'reminder_24h', state: 'all' }, { now })).items.find((row) => row.assignmentId === 300);
    assert.ok(task);
    const [reminder, concurrent] = await Promise.all([
      invoke('/assignments/:assignmentId', { assignmentId: '300' }),
      invoke('/assignments/:assignmentId', { assignmentId: '300' }),
    ]);
    assert.equal(reminder.qrUrl, concurrent.qrUrl);
    assert.equal(await db.qrCheckCode.count({ where: { assignmentId: 300 } }), 1);
    const saved = await db.qrCheckCode.findUnique({ where: { assignmentId: 300 } });
    const page = await invoke('/events/:eventId', { eventId: '1' }, { pageSize: 100 });
    const tableRow = page.rows.find((row) => row.assignmentId === 300);
    assert.equal(tableRow.qrUrl, reminder.qrUrl);
    assert.equal(tableRow.collaboratorId, task.collaboratorId);
    assert.equal(tableRow.collaboratorName, task.collaboratorName);
    assert.equal(tableRow.eventName, task.eventName);
    assert.equal(tableRow.startTime, task.startTime);
    assert.equal(tableRow.endTime, task.endTime);
    assert.equal(tableRow.assignmentDate.toISOString().slice(0, 10), task.date);
    assert.deepEqual(await db.qrCheckCode.findUnique({ where: { assignmentId: 300 } }), saved);
    const other = await invoke('/assignments/:assignmentId', { assignmentId: '201' });
    assert.notEqual(other.qrUrl, reminder.qrUrl);
    assert.equal(other.assignmentId, 201);
    await db.eventAssignment.create({ data: { id: 301, eventId: 2, collaboratorId: 2, assignmentDate: new Date('2026-09-23'), plannedCheckIn: '18:00', plannedCheckOut: '22:00', status: 'confirmed' } });
    const secondService = await invoke('/assignments/:assignmentId', { assignmentId: '301' });
    assert.equal(secondService.qrScope, 'day');
    assert.equal(secondService.qrUrl, reminder.qrUrl);
    assert.match(secondService.qrUrl, /\/qr\/day\/day1\./);
  } finally {
    await prisma.$disconnect();
  }
});
