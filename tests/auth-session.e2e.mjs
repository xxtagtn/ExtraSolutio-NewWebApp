// Run against Vite. PLAYWRIGHT_MODULE can point to an external Playwright installation.
// API routes are mocked and the browser clock is advanced; no real credentials or data are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5180';
const minute = 60000;
const initialTime = Date.UTC(2026, 8, 24, 10);
const user = { id: 1, name: 'Session Test', email: 'test@example.test', role: 'operations', permissions: ['dashboard.view', 'communication.view'] };
const jwt = (now, ttl) => `header.${Buffer.from(JSON.stringify({ iat: now / 1000, exp: (now + ttl) / 1000 })).toString('base64url')}.signature`;
const dialogs = [];
const errors = [];

async function setup(ttl = 4 * 60 * minute) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.clock.install({ time: initialTime });
  await page.clock.pauseAt(initialTime + 1000);
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  page.on('pageerror', (error) => errors.push(error.message));
  let status = 200;
  let refreshes = 0;
  let rejectLogin = false;
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    const send = (json, code = 200) => route.fulfill({ status: code, json });
    if (path === '/auth/login' || path === '/auth/refresh') {
      if (path === '/auth/login' && rejectLogin) return send({ message: 'Credenciais inválidas.' }, 401);
      if (path === '/auth/refresh') refreshes++;
      const now = await page.evaluate(() => Date.now());
      return send({ token: jwt(now, ttl), user });
    }
    if (path === '/probe') return send(status === 200 ? { ok: true } : { message: status === 401 ? 'Login Expirado' : 'Sem permissões.' }, status);
    if (path === '/auth/password') return send({ message: 'Password atual invalida.' }, 401);
    if (path === '/notifications/overview') return send({ notifications: { total: 0, items: [], allItems: [] }, reminders: [] });
    if (path === '/communication/tasks') return send({ items: [], total: 0, totalPages: 1, events: [], summary: {} });
    return send([]);
  });
  await page.goto(`${base}/profile`);
  await page.waitForURL('**/login');
  return { context, page, status: (value) => { status = value; }, rejectLogin: (value) => { rejectLogin = value; }, refreshes: () => refreshes };
}

async function login(page) {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.goto(`${base}/profile`);
  await page.getByLabel('Nome', { exact: true }).waitFor();
}

async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('extrasolutio.auth') || 'null'));
}

try {
  const idle = await setup();
  await login(idle.page);
  const initialAuth = await stored(idle.page);
  await idle.page.clock.fastForward(59 * minute);
  assert.ok(idle.page.url().endsWith('/profile'));
  // Background requests must not move the inactivity deadline.
  await idle.page.evaluate(async () => { const { api } = await import('/src/utils/api.js'); await api('/probe'); });
  await idle.page.clock.fastForward(minute);
  await idle.page.waitForURL('**/login');
  assert.equal(await stored(idle.page), null);
  assert.equal(await idle.page.evaluate(() => localStorage.getItem('extrasolutio.auth.activity')), null);
  await login(idle.page);
  const newAuth = await stored(idle.page);
  assert.notEqual(newAuth.sessionId, initialAuth.sessionId);
  assert.deepEqual(newAuth.user, initialAuth.user);
  await idle.page.clock.fastForward(minute);
  assert.ok(idle.page.url().endsWith('/profile'));
  await idle.context.close();
  console.log('PASS valid session, 60-minute idle redirect, cleared storage, new login and unchanged permissions');

  const active = await setup(60 * minute);
  await login(active.page);
  await active.page.getByLabel('Nome', { exact: true }).focus();
  await active.page.clock.fastForward(30 * minute);
  await active.page.keyboard.type(' A');
  const firstToken = (await stored(active.page)).token;
  await active.page.clock.fastForward(20 * minute);
  await active.page.waitForFunction((previous) => JSON.parse(localStorage.getItem('extrasolutio.auth')).token !== previous, firstToken);
  await active.page.clock.fastForward(25 * minute);
  await active.page.keyboard.type(' B');
  const secondToken = (await stored(active.page)).token;
  await active.page.clock.fastForward(25 * minute);
  await active.page.waitForFunction((previous) => JSON.parse(localStorage.getItem('extrasolutio.auth')).token !== previous, secondToken);
  await active.page.clock.fastForward(35 * minute - 1);
  assert.ok(active.page.url().endsWith('/profile'));
  assert.ok(active.refreshes() >= 2);
  await active.page.clock.fastForward(1);
  await active.page.waitForURL('**/login');
  await active.context.close();
  console.log('PASS activity at 10:30/11:15, proactive renewal without API use, expiry at 12:15');

  const expired = await setup();
  await login(expired.page);
  const historyLength = await expired.page.evaluate(() => history.length);
  expired.status(401);
  const failures = await expired.page.evaluate(async () => {
    const { api } = await import('/src/utils/api.js');
    return Promise.all([1, 2, 3].map(() => api('/probe').catch((error) => error.name)));
  });
  assert.ok(failures.every((name) => name === 'SessionExpiredError'));
  await expired.page.waitForURL('**/login');
  assert.equal(await expired.page.evaluate(() => history.length), historyLength);
  assert.equal(expired.context.pages().length, 1);
  expired.rejectLogin(true);
  await expired.page.getByLabel('Email', { exact: true }).fill(user.email);
  await expired.page.getByLabel('Password', { exact: true }).fill('incorrect');
  await expired.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expired.page.getByText('Credenciais inválidas.', { exact: true }).waitFor();
  expired.rejectLogin(false);
  expired.status(403);
  await login(expired.page);
  const permissionError = await expired.page.evaluate(async () => {
    const { api } = await import('/src/utils/api.js');
    return api('/probe').catch((error) => error.message);
  });
  assert.equal(permissionError, 'Sem permissões.');
  assert.ok(expired.page.url().endsWith('/profile'));
  assert.ok(await stored(expired.page));
  await expired.context.close();
  console.log('PASS concurrent 401, single redirect, no new tabs, invalid credentials, no 403 logout');

  const tabs = await setup();
  await login(tabs.page);
  const second = await tabs.context.newPage();
  await second.clock.install({ time: initialTime });
  await second.clock.pauseAt(initialTime + 1000);
  await second.goto(`${base}/profile`);
  await second.getByLabel('Nome', { exact: true }).waitFor();
  await tabs.page.evaluate(async () => { const { clearStoredAuth } = await import('/src/utils/api.js'); clearStoredAuth(); });
  await tabs.page.waitForURL('**/login');
  await second.waitForURL('**/login');
  await tabs.context.close();
  console.log('PASS cross-tab logout');

  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  console.log('PASS no blocking alerts or browser errors');
} finally {
  await browser.close();
}
