import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { buildAttendanceAttention, readAttendanceAttention } from './attendanceAttention.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { groupQrRowsByCollaboratorDay } from '../../src/utils/communicationQrGroups.js';

const timeZone = 'Europe/Lisbon';
const options = (time, day = '2026-09-25') => ({ now: eventStartInstant(day, time, timeZone), timeZone });
const row = (changes = {}) => ({
  id: 1, collaboratorId: 2, status: 'confirmed', role: 'Emp.Mesa', validationStatus: 'pending',
  assignmentDate: '2026-09-25', plannedCheckIn: '11:00', plannedCheckOut: '15:00', checkIn: null, checkOut: null,
  collaborator: { name: 'Ana Silva' }, workLocation: { name: 'Lounge A' },
  event: { id: 10, date: '2026-09-01', name: 'Evento contínuo', status: 'in_progress', workLocationsEnabled: true },
  ...changes,
});
const result = (changes, time, day) => buildAttendanceAttention([row(changes)], options(time, day));

test('entry is only flagged after its own planned start and never marks an absence', () => {
  assert.equal(result({}, '10:59').total, 0);
  assert.equal(result({}, '11:00').total, 0);
  const source = row();
  const snapshot = structuredClone(source);
  const payload = buildAttendanceAttention([source], options('11:01'));
  assert.deepEqual(payload.summary, { missing_entry: 1, missing_exit: 0, incomplete: 0 });
  assert.equal(payload.items[0].reason, 'Entrada por registar');
  assert.equal(payload.items[0].to, '/services/10?tab=team&day=2026-09-25');
  assert.equal(payload.items[0].workLocation, 'Lounge A');
  assert.deepEqual(source, snapshot);
});

test('exit is only flagged after the planned end, with changes reflected immediately', () => {
  assert.equal(result({ checkIn: '11:02' }, '12:00').total, 0);
  assert.equal(result({ checkIn: '11:02' }, '15:00').total, 0);
  assert.equal(result({ checkIn: '11:02' }, '15:01').items[0].kind, 'missing_exit');
  assert.equal(result({ checkIn: '11:02', checkOut: '15:02' }, '15:03').total, 0);
  assert.equal(result({ checkIn: '11:02', checkOut: null }, '15:03').items[0].kind, 'missing_exit');
  assert.equal(result({ checkIn: null, checkOut: '15:02' }, '15:03').items[0].reason, 'Saída registada sem entrada');
  assert.equal(result({ checkIn: '11:02', checkOut: '15:02' }, '15:03').total, 0);
});

test('no-show, removed, cancelled, unassigned, validated and closed services are excluded', () => {
  for (const status of ['missed_justified', 'missed_unjustified', 'cancelled', 'canceled', 'removed']) {
    assert.equal(result({ status }, '16:00').total, 0, status);
  }
  assert.equal(result({ collaboratorId: null }, '16:00').total, 0);
  assert.equal(result({ validationStatus: 'validated' }, '16:00').total, 0);
  for (const status of ['cancelled', 'finalized', 'completed', 'invoiced', 'paid']) {
    assert.equal(result({ event: { ...row().event, status } }, '16:00').total, 0, status);
  }
  assert.equal(result({ event: { ...row().event, cancelledDays: JSON.stringify(['2026-09-25']) } }, '16:00').total, 0);
  assert.equal(result({ event: { ...row().event, cancelledDays: JSON.stringify(['2026-09-24']) } }, '16:00').total, 1);
});

test('split shifts and continuous-event days are checked independently', () => {
  const rows = [
    row({ checkIn: '11:00', checkOut: '15:00' }),
    row({ id: 2, plannedCheckIn: '16:00', plannedCheckOut: '20:00' }),
    row({ id: 3, assignmentDate: '2026-09-26' }),
    row({ id: 4, collaboratorId: 3, status: 'missed_justified' }),
  ];
  assert.equal(buildAttendanceAttention(rows, options('15:30')).total, 0);
  assert.deepEqual(buildAttendanceAttention(rows, options('16:01')).items.map((item) => item.assignmentId), [2]);
  assert.equal(buildAttendanceAttention(rows, options('16:01')).items[0].to, '/services/10?tab=team&day=2026-09-25');
});

test('alerts expose collaborator identity for display grouping without merging days or changing alerts', () => {
  const rows = [
    row({ checkIn: '11:00' }),
    row({ id: 2, plannedCheckIn: '16:00', plannedCheckOut: '20:00', event: { ...row().event, id: 11, name: 'Outro evento' } }),
    row({ id: 3, collaboratorId: 3 }),
    row({ id: 4, assignmentDate: '2026-09-24', plannedCheckIn: '20:00', plannedCheckOut: '23:00', checkIn: '20:00' }),
  ];
  const payload = buildAttendanceAttention(rows, options('17:00'));
  const snapshot = structuredClone(payload);
  const groups = groupQrRowsByCollaboratorDay(payload.items);
  assert.equal(payload.total, 4);
  assert.deepEqual(payload.summary, { missing_entry: 2, missing_exit: 2, incomplete: 0 });
  assert.equal(groups.length, 3);
  const group = groups.find((item) => item.key === '2:2026-09-25');
  assert.deepEqual(group.rows.map((item) => item.assignmentId), [1, 2]);
  assert.deepEqual(group.rows.map((item) => item.kind), ['missing_exit', 'missing_entry']);
  assert.deepEqual(group.rows.map((item) => item.to), ['/services/10?tab=team&day=2026-09-25', '/services/11?tab=team&day=2026-09-25']);
  assert.deepEqual(payload, snapshot);
});

test('overnight shifts do not warn before end; missing exits expire exactly 24h later', () => {
  const overnight = { plannedCheckIn: '22:00', plannedCheckOut: '02:00', checkIn: '22:02' };
  assert.equal(result(overnight, '23:00').total, 0);
  assert.equal(result(overnight, '01:59', '2026-09-26').total, 0);
  assert.equal(result({ ...overnight, checkIn: '00:15' }, '01:59', '2026-09-26').total, 0);
  assert.equal(result(overnight, '02:01', '2026-09-26').items[0].kind, 'missing_exit');
  assert.equal(result(overnight, '01:59', '2026-09-27').total, 1);
  assert.equal(result(overnight, '02:00', '2026-09-27').total, 0);
  assert.equal(result({ ...overnight, checkOut: '02:05' }, '02:06', '2026-09-26').total, 0);
});

test('incomplete or invalid schedules are informative, without inventing a deadline', () => {
  assert.equal(result({ plannedCheckOut: null }, '10:00').total, 0);
  assert.equal(result({ plannedCheckOut: null }, '11:01').items[0].reason, 'Horário previsto incompleto');
  assert.equal(result({ plannedCheckIn: null }, '10:00').items[0].kind, 'incomplete');
  assert.equal(result({ checkIn: '99:00' }, '12:00').items[0].reason, 'Picagem com horário inválido');
  assert.equal(result({ checkIn: '11:00', checkOut: 'bad' }, '12:00').items[0].kind, 'incomplete');
  assert.equal(result({ assignmentDate: '2026-09-26', plannedCheckIn: null, plannedCheckOut: null }, '12:00').total, 0);
  assert.equal(result({ assignmentDate: '2026-09-20' }, '16:00').total, 0);
});

test('single-day events inherit times and the application timezone handles midnight and DST', () => {
  const single = { assignmentDate: null, plannedCheckIn: null, plannedCheckOut: null,
    event: { ...row().event, date: '2026-09-25', startTime: '11:00', endTime: '15:00', workLocationsEnabled: false } };
  assert.equal(result(single, '11:01').items[0].workLocation, '');
  const midnight = row({ plannedCheckIn: '00:00', plannedCheckOut: '08:00' });
  assert.equal(buildAttendanceAttention([midnight], { now: new Date('2026-09-24T23:01:00Z'), timeZone }).total, 1);
  for (const [day, next] of [['2026-03-28', '2026-03-29'], ['2026-10-24', '2026-10-25']]) {
    const shift = row({ assignmentDate: day, plannedCheckIn: '23:00', plannedCheckOut: '04:00', checkIn: '23:00' });
    assert.equal(buildAttendanceAttention([shift], options('03:59', next)).total, 0);
    assert.equal(buildAttendanceAttention([shift], options('04:01', next)).items[0].kind, 'missing_exit');
  }
});

const directory = mkdtempSync(join(tmpdir(), 'es-attention-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl, log: [{ emit: 'event', level: 'query' }] });
let queries = [];
db.$on('query', (entry) => queries.push(entry.query));

before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], { env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(migration.stdout);
  sqlite.close();
  await db.collaborator.create({ data: { id: 2, name: 'Ana Silva', email: 'attention@example.test', nif: 'private', hourlyRate: 10 } });
  await db.event.create({ data: { id: 10, name: 'Evento contínuo', date: new Date('2026-09-01'), endDate: new Date('2026-09-30'), isContinuous: true, status: 'confirmed', totalRevenue: 100 } });
  await db.eventAssignment.createMany({ data: [
    { id: 1, eventId: 10, collaboratorId: 2, assignmentDate: new Date('2026-09-25'), plannedCheckIn: '11:00', plannedCheckOut: '15:00', status: 'confirmed', totalPay: 40 },
    { id: 2, eventId: 10, collaboratorId: 2, assignmentDate: new Date('2026-09-01'), plannedCheckIn: '11:00', plannedCheckOut: '15:00', status: 'confirmed' },
  ] });
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

test('database query is bounded and read-only; manual corrections remove or reopen alerts', async () => {
  const before = await db.eventAssignment.findMany();
  queries = [];
  const payload = await readAttendanceAttention(db, options('16:00'));
  assert.deepEqual(payload.items.map((item) => item.assignmentId), [1]);
  assert.equal(payload.items[0].collaboratorId, 2);
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.ok(queries.some((sql) => /assignmentDate/.test(sql) && />=/.test(sql)));
  assert.doesNotMatch(JSON.stringify(payload), /nif|hourlyRate|totalPay|totalRevenue|private/);
  assert.deepEqual(await db.eventAssignment.findMany(), before);
  await db.eventAssignment.update({ where: { id: 1 }, data: { checkIn: '11:01', checkOut: '15:01' } });
  assert.equal((await readAttendanceAttention(db, options('16:00'))).total, 0);
  await db.eventAssignment.update({ where: { id: 1 }, data: { checkOut: null } });
  assert.equal((await readAttendanceAttention(db, options('16:00'))).items[0].kind, 'missing_exit');
  assert.equal((await db.eventAssignment.findUnique({ where: { id: 1 } })).totalPay.toString(), '40');
});

test('endpoint requires dashboard and service permissions and returns a non-cacheable response', async () => {
  process.env.DATABASE_URL = datasourceUrl;
  const { notificationsRouter } = await import('../routes/notifications.js');
  const { prisma } = await import('../prisma.js');
  const route = notificationsRouter.stack.find((layer) => layer.route?.path === '/attendance-attention').route;
  async function invoke(permissions) {
    const result = { status: 200, headers: {} };
    const req = { user: { role: 'operations', permissions } };
    const res = { status: (status) => { result.status = status; return res; }, set: (key, value) => { result.headers[key] = value; }, json: (body) => { result.body = body; } };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, (error) => { if (error) throw error; proceed = true; });
      if (!proceed) break;
    }
    return result;
  }
  try {
    for (const permissions of [[], ['dashboard.view'], ['services.view']]) assert.equal((await invoke(permissions)).status, 403);
    const allowed = await invoke(['dashboard.view', 'services.view']);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
    assert.ok(Array.isArray(allowed.body.items));
  } finally { await prisma.$disconnect(); }
});
