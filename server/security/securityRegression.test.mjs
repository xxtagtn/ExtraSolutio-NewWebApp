import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { issueSessionToken } from './sessionTokens.js';
import { captureWhatsAppBody, verifyWhatsAppSignature } from './whatsappSignature.js';
import { privatePublicAssets, publicAssetFiles } from '../../scripts/privatePublicAssets.js';

process.env.JWT_SECRET = 'isolated-security-test-secret-only';
process.env.WHATSAPP_APP_SECRET = 'isolated-meta-app-secret-only';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'isolated-verify-token-only';
process.env.WHATSAPP_AUTO_REPLY_ENABLED = 'false';
let server, base, directory, prisma, user, viewer;
let reads = 0, writes = 0;
const photo = Buffer.from('private-photo-fixture');
const oldPassword = 'Audit-Old-Password-2026!';
const newPassword = 'Audit-New-Password-2026!';

before(async () => {
  ({ prisma } = await import('../prisma.js'));
  user = { id: 9901, email: 'audit@example.invalid', name: 'QA', password: await bcrypt.hash(oldPassword, 12), role: 'admin',
    accessProfile: null, accessProfileId: null, permissionOverrides: null, photo: null };
  viewer = { ...user, id: 9902, role: 'operations', permissionOverrides: '{"deny":["collaborators.view"]}' };
  prisma.user.findUnique = async ({ where }) => where.id === viewer.id ? { ...viewer } : { ...user };
  prisma.user.update = async ({ data }) => { user = { ...user, ...data }; return { ...user }; };
  prisma.communicationLog.findMany = async () => {
    reads++;
    return [{ id: 1, status: 'accepted', response: JSON.stringify({ messageId: 'qa-fictional-message' }) }];
  };
  prisma.communicationLog.update = async ({ data }) => { writes++; return { id: 1, ...data }; };
  directory = await mkdtemp(join(tmpdir(), 'es-security-'));
  await mkdir(join(directory, 'thumbs'));
  await writeFile(join(directory, 'collab-test.png'), photo);
  await writeFile(join(directory, 'thumbs', 'collab-thumb-test.png'), photo);
  const { authRouter } = await import('../routes/auth.js');
  const { requireAuth } = await import('../middleware/auth.js');
  const { whatsappWebhookRouter } = await import('../routes/whatsapp.js');
  const { createPrivateUploadsRouter } = await import('../routes/privateUploads.js');
  const app = express();
  app.use(express.json({ limit: '8mb', verify: captureWhatsAppBody }));
  app.use('/uploads', (_req, res) => res.sendStatus(404));
  app.use('/api/auth', authRouter);
  app.use('/api/whatsapp', whatsappWebhookRouter);
  app.use('/api/uploads', requireAuth, createPrivateUploadsRouter({ root: directory }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await prisma?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const auth = token => ({ Authorization: `Bearer ${token}` });
const sign = raw => `sha256=${createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
  statuses: [{ id: 'qa-fictional-message', status: 'read' }],
} }] }] });
const webhook = (raw, signature) => fetch(`${base}/api/whatsapp/webhook`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Hub-Signature-256': signature } : {}) }, body: raw });

test('webhook rejects absent, malformed, forged and changed-body signatures without processing', async () => {
  reads = 0; writes = 0;
  for (const signature of [undefined, 'sha256=invalid', `sha256=${'0'.repeat(64)}`, sign(`${payload} `)]) {
    assert.equal((await webhook(payload, signature)).status, 401);
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
});

test('webhook validates exact bytes, unicode, whitespace and byte-order changes', () => {
  const raw = Buffer.from('{ "texto": "Ol\u00e1", "x": 1 }');
  assert.equal(verifyWhatsAppSignature(raw, sign(raw), process.env.WHATSAPP_APP_SECRET), true);
  assert.equal(verifyWhatsAppSignature(Buffer.from(JSON.stringify(JSON.parse(raw))), sign(raw), process.env.WHATSAPP_APP_SECRET), false);
  assert.equal(verifyWhatsAppSignature(raw, sign(raw), 'wrong-secret'), false);
  assert.equal(verifyWhatsAppSignature(undefined, sign(raw), process.env.WHATSAPP_APP_SECRET), false);
});

test('valid webhook still processes delivery, with no WhatsApp message sent', async () => {
  reads = 0; writes = 0;
  assert.equal((await webhook(payload, sign(payload))).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(writes, 1);
});

test('missing app secret fails closed, while the GET verification flow remains unchanged', async () => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  try { assert.equal((await webhook('{}')).status, 503); }
  finally { process.env.WHATSAPP_APP_SECRET = secret; }
  const response = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=isolated-verify-token-only&hub.challenge=qa-challenge`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'qa-challenge');
  assert.equal((await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong`)).status, 403);
});

test('photos require a current session and collaborator permission, including HEAD and thumbnails', async () => {
  const path = '/api/uploads/collaborators/collab-test.png';
  assert.equal((await fetch(`${base}/uploads/collaborators/collab-test.png`)).status, 404);
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(base + path, { method: 'HEAD' })).status, 401);
  assert.equal((await fetch(base + path, { headers: auth(issueSessionToken(viewer)) })).status, 403);
  for (const file of ['collab-test.png', 'thumbs/collab-thumb-test.png']) {
    const r = await fetch(`${base}/api/uploads/collaborators/${file}`, { headers: auth(issueSessionToken(user)) });
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('etag'), null);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), photo);
  }
  const headers = auth(issueSessionToken(user));
  assert.equal((await fetch(`${base}/api/uploads/collaborators/`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/uploads/other/no.png`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/uploads/collaborators/.hidden`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/uploads/collaborators/%2e%2e%2fsecret`, { headers })).status, 404);
});

test('password change revokes old and refreshed tokens, and does not expose hashes', async () => {
  const token = issueSessionToken(user);
  const refreshed = await (await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: auth(token) })).json();
  assert.ok(refreshed.token); assert.equal(refreshed.user.password, undefined);
  const r = await fetch(`${base}/api/auth/password`, { method: 'PUT', headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword }) });
  assert.equal(r.status, 200);
  const updated = await r.json(); assert.ok(updated.token); assert.equal(updated.user.password, undefined);
  assert.equal(JSON.stringify(updated).includes(user.password), false);
  for (const old of [token, refreshed.token]) {
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth(old) })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: auth(old) })).status, 401);
    assert.equal((await fetch(`${base}/api/uploads/collaborators/collab-test.png`, { headers: auth(old) })).status, 401);
  }
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth(updated.token) })).status, 200);
  const login = password => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }) });
  assert.equal((await login(oldPassword)).status, 401); assert.equal((await login(newPassword)).status, 200);
});

test('legacy, expired and tampered tokens are rejected; profile changes keep current credentials valid', async () => {
  const token = issueSessionToken(user);
  const legacy = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  for (const invalid of [legacy, issueSessionToken(user, { expiresIn: '-1s' }), `${token.slice(0, -6)}broken`]) {
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth(invalid) })).status, 401);
  }
  user.name = 'Updated QA name';
  const me = await (await fetch(`${base}/api/auth/me`, { headers: auth(token) })).json();
  assert.equal(me.user.name, user.name); assert.equal(me.user.password, undefined);
  assert.ok(me.user.permissions);
});

test('public build assets exclude uploads but retain the PWA files', async () => {
  const root = join(directory, 'public');
  await mkdir(join(root, 'uploads', 'collaborators'), { recursive: true });
  await mkdir(join(root, 'pwa-icons'));
  await writeFile(join(root, 'uploads', 'collaborators', 'private.png'), photo);
  for (const name of ['logo.png', 'service-worker.js', 'manifest-v6.webmanifest', 'pwa-icons/icon.png']) await writeFile(join(root, name), name);
  const files = (await publicAssetFiles(root)).map(asset => asset.fileName).sort();
  assert.deepEqual(files, ['logo.png', 'manifest-v6.webmanifest', 'pwa-icons/icon.png', 'service-worker.js']);
});

test('development server rejects normal, encoded and filesystem private-photo URLs before serving assets', () => {
  let middleware;
  privatePublicAssets().configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  for (const url of ['/uploads/collaborators/test.png', '/u%70loads/collaborators/test.png',
    '/@fs/C:/Workspace/public/uploads/collaborators/test.png?raw',
    '/@fs/var/www/app/public/uploads/collaborators/test.png', '/public%2fuploads/test.png']) {
    let ended = false, next = false;
    const res = { end() { ended = true; } };
    middleware({ url }, res, () => { next = true; });
    assert.equal(res.statusCode, 404, url); assert.equal(ended, true); assert.equal(next, false);
  }
  let passed = false;
  middleware({ url: '/api/uploads/collaborators/test.png' }, {}, () => { passed = true; });
  assert.equal(passed, true, 'The authenticated API is not a public asset route');
});
