import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import express from 'express';
import { publicUniform } from '../utils/publicUniform.js';
import { normalizeEvent } from '../routes/crud.js';
import { ensureCollaboratorAttendanceLink, readCollaboratorAttendanceLink } from './collaboratorAttendanceLink.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { readDailyQr } from './qrDailyAttendance.js';
import { monthlyServicePayload } from './qrMonthlyAttendance.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import { issueSessionToken } from '../security/sessionTokens.js';

test('uniform notes can be edited, cleared and omitted without touching internal notes', () => {
  assert.equal(normalizeEvent({ uniformNotes: '  Avental fornecido no local.\nLevar gravata.  ' }).uniformNotes,
    'Avental fornecido no local.\nLevar gravata.');
  assert.equal(normalizeEvent({ uniformNotes: ' ' }).uniformNotes, null);
  assert.equal(normalizeEvent({ uniform: '' }).uniform, null);
  assert.equal(Object.hasOwn(normalizeEvent({ location: 'Lisboa' }), 'uniformNotes'), false);
  assert.equal(normalizeEvent({ uniformNotes: 'x'.repeat(1200) }).uniformNotes.length, 1000);
  assert.deepEqual(publicUniform({ uniform: ' Camisa branca ', uniformNotes: ' Avental fornecido. ', notes: 'PRIVADO' }),
    { uniform: 'Camisa branca', uniformNotes: 'Avental fornecido.' });
  assert.deepEqual(publicUniform(), { uniform: '', uniformNotes: '' });
});

test('saved uniform notes reach the same permanent, daily and single links, never internal event notes', async (t) => {
  const cache = resolve('node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'qr-uniform-'));
  const file = join(directory, 'test.db');
  process.env.DATABASE_URL = `file:${file.replaceAll('\\', '/')}`;
  process.env.JWT_SECRET = 'uniform-isolated-test-secret-no-live-access';
  process.env.APP_TIMEZONE = 'Europe/Lisbon';
  let db, server;
  const now = new Date('2026-11-18T10:30:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  try {
    const sql = new DatabaseSync(file);
    try {
      for (const name of readdirSync('prisma/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) {
        sql.exec(readFileSync(join('prisma/sqlite/migrations', name, 'migration.sql'), 'utf8'));
      }
    } finally { sql.close(); }
    db = (await import('../prisma.js')).prisma;
    const { apiRouter } = await import('../routes/index.js');
    const user = await db.user.create({ data: { email: 'uniform@example.test', name: 'QA', role: 'admin', password: 'unused' } });
    const staff = await db.collaborator.create({ data: { name: 'Inês Martins', email: 'uniform-staff@example.test' } });
    const event = await db.event.create({ data: {
      name: 'Evento QA', date: new Date('2026-11-18'), startTime: '11:00', endTime: '16:00',
      status: 'confirmed', statusMode: 'manual', uniform: 'Camisa branca', notes: 'INTERNAL_NOTE_NEVER_PUBLIC',
      requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty: 1, agreedRate: 12 }]),
    } });
    const assignment = await db.eventAssignment.create({ data: {
      eventId: event.id, collaboratorId: staff.id, status: 'confirmed', role: 'Emp.Mesa',
      plannedCheckIn: '11:00', plannedCheckOut: '16:00', hourlyRate: 8,
    } });
    const qr = await ensureAssignmentQr(db, assignment.id);
    const link = await ensureCollaboratorAttendanceLink(db, staff.id);
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const update = (uniformNotes, extra = {}) => fetch(`${base}/services/${event.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${issueSessionToken(user)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniformNotes, ...extra }),
    });
    const saved = await update('Avental fornecido no local.');
    assert.equal(saved.status, 200, (await saved.clone().text()));
    assert.equal((await saved.json()).uniformNotes, 'Avental fornecido no local.');
    const permanent = await readCollaboratorAttendanceLink(db, link.token, { now });
    assert.equal(permanent.services[0].uniform, 'Camisa branca');
    assert.equal(permanent.services[0].uniformNotes, 'Avental fornecido no local.');
    assert.equal(permanent.active.services[0].uniformNotes, 'Avental fornecido no local.');
    const daily = await readDailyQr(db, createDailyQrToken(staff.id, '2026-11-18'), { now });
    assert.equal(daily.services[0].uniformNotes, 'Avental fornecido no local.');
    const single = await fetch(`${base}/qr-check/${qr.token}`);
    assert.equal(single.status, 200);
    assert.equal((await single.json()).uniformNotes, 'Avental fornecido no local.');
    assert.equal(JSON.stringify(permanent).includes('INTERNAL_NOTE_NEVER_PUBLIC'), false);
    const row = await db.eventAssignment.findUnique({ where: { id: assignment.id }, include: { event: true, collaborator: true } });
    assert.equal(monthlyServicePayload(row, now).uniformNotes, 'Avental fornecido no local.');
    assert.equal(await db.qrCheckLog.count(), 0, 'Reading clothing never registers attendance');
    assert.equal(Number(row.hourlyRate), 8);
    assert.equal((await update('')).status, 200);
    const cleared = await readCollaboratorAttendanceLink(db, link.token, { now });
    assert.equal(cleared.services[0].uniformNotes, '');
    assert.equal(cleared.services[0].uniform, 'Camisa branca');
    assert.equal((await update('Levar sapatos pretos.', { uniform: '' })).status, 200);
    const notesOnly = await readCollaboratorAttendanceLink(db, link.token, { now });
    assert.equal(notesOnly.services[0].uniform, '');
    assert.equal(notesOnly.services[0].uniformNotes, 'Levar sapatos pretos.');
    assert.equal((await db.collaboratorAttendanceLink.findUnique({ where: { collaboratorId: staff.id } })).token, link.token);
  } finally {
    if (server) await new Promise((done) => server.close(done));
    if (db) await db.$disconnect();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});
