import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { issueSessionToken } from '../security/sessionTokens.js';

const directory = mkdtempSync(join(tmpdir(), 'es-collaborator-search-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl;
process.env.JWT_SECRET = 'collaborator-search-test-only-secret';
const db = new PrismaClient({ datasourceUrl });
let server, base, prisma, adminHeaders, opsHeaders, allowedHeaders, deniedHeaders, people;
const query = async (params = {}, headers = adminHeaders) => {
  const response = await fetch(`${base}?${new URLSearchParams({ light: '1', page: '1', pageSize: '10', ...params })}`, { headers });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(migration.status, 0, migration.stderr);
  const sqlite = new DatabaseSync(database); sqlite.exec(migration.stdout); sqlite.close();
  const users = [];
  for (const [key, role, permissionOverrides] of [
    ['admin', 'admin', null], ['ops', 'operations', null],
    ['allowed', 'operations', '{"allow":["collaborators.viewSensitive"]}'],
    ['denied', 'operations', '{"deny":["collaborators.view"]}'],
  ]) users.push(await db.user.create({ data: { name: key, email: `${key}@search.example.invalid`, password: 'test-hash-only', role, permissionOverrides } }));
  [adminHeaders, opsHeaders, allowedHeaders, deniedHeaders] = users.map(user => ({ Authorization: `Bearer ${issueSessionToken(user)}` }));
  const fixture = (name, roles, patch = {}) => db.collaborator.create({ data: {
    name, email: `${name.replaceAll(' ', '-')}@example.invalid`, status: 'active', roles: { create: roles.map(role => ({ role })) }, ...patch,
  } });
  people = [
    await fixture('Rita da Silva', ['Barman', 'Copa Fina'], { shortName: 'Rita Silva', residenceArea: 'Sintra',
      notes: 'Boa experiência em casamentos. Confidencial da ficha.', availability: 'Fins de semana', hasOwnCar: true, nif: '999000111' }),
    await fixture('Rita Mendes', ['Emp.Mesa'], { residenceArea: 'Lisboa', notes: 'Não pode trabalhar à noite', status: 'inactive' }),
    await fixture('João da Costa', ['Ajd.Cozinha', 'Copa Fina'], { residenceArea: 'Sintra', hasOwnCar: true,
      notes: 'Experiência em casamentos', availability: 'Sábados à noite' }),
    await fixture('Joao Santos', ['Barman'], { residenceArea: 'Cascais', notes: 'Tem carro emprestado', status: 'paused' }),
  ];
  for (let i = 0; i < 24; i++) people.push(await fixture(`Pessoa ${String(i).padStart(2, '0')}`, ['Emp.Mesa', 'Copa Fina'], {
    notes: i === 23 ? 'Agendamento especial' : 'Equipa de apoio', residenceArea: 'Oeiras', hasOwnCar: i % 2 === 0, isPreferred: i === 12,
  }));
  ({ prisma } = await import('../prisma.js'));
  const { requireAuth } = await import('../middleware/auth.js');
  const { collaboratorsRouter } = await import('./collaborators.js');
  const app = express(); app.use('/api/collaborators', requireAuth, collaboratorsRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/collaborators`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await prisma?.$disconnect(); await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
const ids = result => result.body.items.map(row => row.id).sort((a,b) => a-b);

test('HTTP full and partial names ignore case and accents, including query aliases', async () => {
  assert.deepEqual(ids(await query({ search: 'RÍTA da SILVA' })), [people[0].id]);
  assert.deepEqual(ids(await query({ q: 'Joao' })), [people[2].id, people[3].id]);
  assert.deepEqual(ids(await query({ name: 'Silv' })), [people[0].id]);
});

test('HTTP real functions, notes and zones search before pagination and aliases cover existing abbreviations', async () => {
  assert.deepEqual(ids(await query({ search: 'Empregado de mesa', pageSize: '100' })), [people[1], ...people.slice(4)].map(row=>row.id));
  assert.deepEqual(ids(await query({ search: 'ajudante cozinha' })), [people[2].id]);
  assert.deepEqual(ids(await query({ search: 'experiencia casamentos' })), [people[0].id, people[2].id]);
  assert.deepEqual(ids(await query({ search: 'sintra' })), [people[0].id, people[2].id]);
  assert.deepEqual(ids(await query({ search: 'agendamento especial' })), [people.at(-1).id]);
});

test('HTTP combines terms across fields on the same person, never a union', async () => {
  assert.deepEqual(ids(await query({ search: 'Rita Bar' })), [people[0].id]);
  assert.deepEqual(ids(await query({ search: 'Copa Sintra' })), [people[0].id, people[2].id]);
  assert.deepEqual(ids(await query({ search: 'Joao carro' })), [people[2].id, people[3].id]);
  assert.deepEqual(ids(await query({ search: 'Rita cozinha' })), []);
  assert.deepEqual(ids(await query({ search: 'Rita Bar casamentos Sintra' })), [people[0].id]);
});

test('HTTP independent structured filters and text intersect, and removing only text retains selected filters', async () => {
  const filters = { role: 'Copa Fina', ownCar: 'true', zone: 'síNtr', status: 'active' };
  assert.deepEqual(ids(await query({ ...filters, search: 'Rita' })), [people[0].id]);
  assert.deepEqual(ids(await query(filters)), [people[0].id, people[2].id]);
  assert.deepEqual(ids(await query({ role: 'Barman', ownCar: 'false' })), [people[3].id]);
  const none = await query({ search: 'naoexiste', ...filters });
  assert.equal(none.body.total, 0); assert.deepEqual(none.body.items, []); assert.equal(none.body.totalPages, 1);
});

test('HTTP multiple functions never duplicate results or change the page counts and preference ordering', async () => {
  const pages = [];
  for (const page of ['1','2','3']) pages.push((await query({ search: 'Pessoa Copa', page })).body);
  assert.ok(pages.every(page => page.total === 24 && page.totalPages === 3));
  const returned = pages.flatMap(page => page.items.map(row => row.id));
  assert.equal(new Set(returned).size, 24);
  assert.equal(returned[0], people[16].id, 'Preferred collaborator still appears first');
  assert.deepEqual([...returned].sort((a,b)=>a-b), people.slice(4).map(row=>row.id));
});

test('HTTP hidden notes, residence and NIF cannot be inferred from search or totals, and existing grants still work', async () => {
  for (const search of ['Confidencial', 'Sintra', '999000111']) {
    const result = await query({ search }, opsHeaders);
    assert.equal(result.status, 200); assert.equal(result.body.total, 0); assert.deepEqual(result.body.items, []);
  }
  assert.equal((await query({ zone: 'Sintra' }, opsHeaders)).status, 403);
  const visible = await query({ search: 'Joao' }, opsHeaders);
  assert.equal(visible.body.total, 2);
  assert.ok(visible.body.items.every(row => row.notes === null && row.residenceArea === null && row.nif === null));
  assert.deepEqual(ids(await query({ search: 'sabados noite' }, opsHeaders)), [people[2].id]);
  assert.deepEqual(ids(await query({ search: 'Confidencial' }, allowedHeaders)), [people[0].id]);
  assert.equal((await query({}, {})).status, 401);
  assert.equal((await query({}, deniedHeaders)).status, 403);
});

test('HTTP projects only necessary candidate fields and cannot index private banking, medical or financial fields', async () => {
  const original = prisma.collaborator.findMany;
  const calls = [];
  prisma.collaborator.findMany = args => { calls.push(args); return original.call(prisma.collaborator, args); };
  try {
    await query({ search: 'Rita' }, opsHeaders);
    for (const field of ['photo', 'photoThumb', 'notes', 'residenceArea', 'nif', 'iban', 'allergies', 'hourlyRate']) {
      assert.equal(calls[0].select[field], undefined, field);
    }
    assert.equal(calls.length, 2, 'One candidate query and one page hydration, no per-person requests');
    assert.equal(calls[1].where.id.in.length, 2);
  } finally { prisma.collaborator.findMany = original; }
});

test('HTTP reads remain current after an authorized edit and do not modify any collaborator records', async () => {
  await db.collaborator.update({ where: { id: people[0].id }, data: { notes: 'Nova nota de agenda' } });
  const before = await db.collaborator.findMany({ include: { roles: true }, orderBy: { id: 'asc' } });
  assert.deepEqual(ids(await query({ search: 'Nova agenda' })), [people[0].id]);
  assert.deepEqual(ids(await query({ search: 'Confidencial' })), []);
  assert.deepEqual(await db.collaborator.findMany({ include: { roles: true }, orderBy: { id: 'asc' } }), before);
});
