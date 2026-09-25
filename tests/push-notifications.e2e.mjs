// API and OS push permission/transport are mocked; no real subscriptions or punches.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import webPush from 'web-push';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const user = { id: 1, name: 'Teste Push', email: 'test@example.test', role: 'admin' };
const key = webPush.generateVAPIDKeys().publicKey;
const errors = [];
const shots = 'node_modules/.cache/push-qa'; mkdirSync(shots, { recursive: true });

async function setup({ width = 390, allowed = true, configured = true, secure = true, permission = 'default' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ secure, permission }) => {
    Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
    window.__permissionCalls = 0; window.__unsubscribes = 0;
    class NotificationMock {
      static permission = permission;
      static async requestPermission() { window.__permissionCalls++; return NotificationMock.permission = NotificationMock.permission === 'denied' ? 'denied' : 'granted'; }
    }
    Object.defineProperty(window, 'Notification', { value: NotificationMock, configurable: true });
    window.__pushPermissionStatus = new EventTarget();
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { async query() { return window.__pushPermissionStatus; } } });
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
    const stored = JSON.parse(localStorage.getItem('test-push-sub') || 'null');
    function hydrate(value) { return value ? { ...value, toJSON() { return value; }, async unsubscribe() { window.__unsubscribes++; localStorage.removeItem('test-push-sub'); sub = null; return true; } } : null; }
    let sub = hydrate(stored);
    const registration = { active: {}, async getNotifications() { return []; }, async update() {}, pushManager: {
      async getSubscription() { return sub; },
      async subscribe() {
        const value = { endpoint: 'https://fcm.googleapis.com/fcm/send/browser-test', keys: { p256dh: 'test', auth: 'test' } };
        localStorage.setItem('test-push-sub', JSON.stringify(value)); sub = hydrate(value); return sub;
      },
    } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { async getRegistration() { return registration; }, async register() { return registration; } } });
  }, { secure, permission });
  let device = null, testCount = 0, requests = [];
  let serverConfigured = configured, configFailure = false;
  let currentUser = allowed ? user : { ...user, role: 'viewer', permissions: ['dashboard.view'] };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    const method = route.request().method(); const body = route.request().postDataJSON();
    const send = (json, status = 200) => route.fulfill({ json, status });
    if (path === '/auth/login' || path === '/auth/refresh') {
      const now = Math.floor(Date.now() / 1000);
      return send({ user: currentUser, token: `header.${Buffer.from(JSON.stringify({ iat: now, exp: now + 14400 })).toString('base64url')}.signature` });
    }
    if (path.startsWith('/push')) requests.push({ path, method, body });
    if (path === '/push/config') return configFailure ? send({ message: 'Servidor temporariamente indisponível.' }, 503) : send({ configured: serverConfigured, publicKey: serverConfigured ? key : null });
    if (path === '/push/device') {
      if (method === 'PUT') device = { id: 1, notifyEntry: body.notifyEntry, notifyExit: body.notifyExit };
      if (method === 'DELETE') device = null;
      return send(device);
    }
    if (path === '/push/test') { testCount++; return send({ message: 'Teste enviado ao serviço de notificações. Confirma a receção no dispositivo.' }); }
    if (path === '/notifications/overview') return send({ notifications: { total: 0, items: [], allItems: [] }, reminders: [] });
    if (path === '/services') return send([{ id: 7, name: 'Evento Push', date: '2026-09-24T00:00:00.000Z', endDate: '2026-09-25T00:00:00.000Z', isContinuous: true, status: 'confirmed', assignments: [], requiredRoles: [] }]);
    return send([]);
  });
  const login = async () => {
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill('test-only-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/login');
  };
  const profile = async () => { await page.goto(`${base}/profile`); await page.getByRole('heading', { name: 'Notificações de picagens' }).waitFor(); };
  await page.goto(`${base}/login`);
  return { context, page, login, profile, tests: () => testCount, device: () => device, requests, changeUser: (value) => { currentUser = value; }, configureServer: (value) => { serverConfigured = value; }, failConfig: (value) => { configFailure = value; } };
}

try {
  const recovered = await setup({ permission: 'denied' }); await recovered.login(); await recovered.profile();
  await recovered.page.getByText('Notificações bloqueadas nas definições deste browser/dispositivo.').waitFor();
  await recovered.page.evaluate(() => { Notification.permission = 'granted'; window.dispatchEvent(new Event('focus')); });
  await recovered.page.waitForFunction(() => ![...document.querySelectorAll('.push-settings button')].find((button) => button.textContent.includes('Ativar neste dispositivo'))?.disabled, { timeout: 3000 });
  await recovered.page.getByRole('button', { name: 'Ativar neste dispositivo' }).click();
  await recovered.page.getByText('Notificações ativas neste dispositivo.', { exact: true }).waitFor();
  await recovered.context.close();
  console.log('PASS return from OS settings refreshes permission without reload');

  const changed = await setup({ permission: 'denied' }); await changed.login(); await changed.profile();
  await changed.page.getByText('Notificações bloqueadas nas definições deste browser/dispositivo.').waitFor();
  await changed.page.evaluate(() => { Notification.permission = 'granted'; window.__pushPermissionStatus.dispatchEvent(new Event('change')); });
  await changed.page.waitForFunction(() => ![...document.querySelectorAll('.push-settings button')].find((button) => button.textContent.includes('Ativar neste dispositivo'))?.disabled);
  assert.equal(await changed.page.evaluate(() => window.__permissionCalls), 0);
  await changed.context.close();
  console.log('PASS permission change refreshes without prompting automatically');

  const configuredLater = await setup({ configured: false }); await configuredLater.login(); await configuredLater.profile();
  await configuredLater.page.getByText('Notificações ainda não configuradas no servidor.').waitFor();
  configuredLater.configureServer(true);
  await configuredLater.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await configuredLater.page.waitForFunction(() => ![...document.querySelectorAll('.push-settings button')].find((button) => button.textContent.includes('Ativar neste dispositivo'))?.disabled);
  configuredLater.failConfig(true);
  await configuredLater.page.getByRole('button', { name: 'Voltar a verificar' }).click();
  await configuredLater.page.getByText('Servidor temporariamente indisponível.').waitFor();
  configuredLater.failConfig(false);
  await configuredLater.page.getByRole('button', { name: 'Voltar a verificar' }).click();
  await configuredLater.page.waitForFunction(() => ![...document.querySelectorAll('.push-settings button')].find((button) => button.textContent.includes('Ativar neste dispositivo'))?.disabled);
  assert.equal(await configuredLater.page.getByText('Servidor temporariamente indisponível.').count(), 0);
  await configuredLater.context.close();
  console.log('PASS server setup is refreshed on return and transient errors can be retried');

  const s = await setup(); await s.login(); await s.profile();
  assert.equal(await s.page.evaluate(() => window.__permissionCalls), 0);
  await s.page.getByRole('button', { name: 'Ativar neste dispositivo' }).click();
  await s.page.getByText('Notificações ativas neste dispositivo.', { exact: true }).waitFor();
  assert.equal(await s.page.evaluate(() => window.__permissionCalls), 1);
  await s.page.getByLabel('Saídas', { exact: true }).uncheck();
  await s.page.getByRole('button', { name: 'Guardar preferências' }).click();
  await s.page.getByText('Preferências guardadas.').waitFor(); assert.equal(s.device().notifyExit, false);
  await s.page.getByRole('button', { name: 'Testar notificação' }).click();
  await s.page.getByText(/Teste enviado ao serviço/).waitFor(); assert.equal(s.tests(), 1);
  for (const width of [320, 390, 1366]) {
    await s.page.setViewportSize({ width, height: 900 });
    await s.page.locator('.push-settings').scrollIntoViewIfNeeded();
    assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    for (const button of await s.page.locator('.push-settings button').all()) assert.ok((await button.boundingBox()).height >= 44);
    await s.page.screenshot({ path: `${shots}/profile-${width}.png`, fullPage: true });
  }
  await s.page.getByRole('button', { name: 'Desativar', exact: true }).click();
  await s.page.getByText('Notificações desativadas neste dispositivo.').waitFor();
  assert.equal(s.device(), null);
  assert.equal(await s.page.evaluate(async () => (await caches.open('extrasolutio-push-settings')).match('/__push-owner').then(Boolean)), false);
  console.log('PASS opt-in permission, preferences, test, disable, mobile 320/390 and desktop 1366');
  await s.context.close();

  for (const settings of [{ secure: false }, { permission: 'denied' }, { configured: false }]) {
    const s = await setup(settings); await s.login(); await s.profile();
    assert.equal(await s.page.getByRole('button', { name: 'Ativar neste dispositivo' }).isDisabled(), true);
    assert.equal(await s.page.evaluate(() => window.__permissionCalls), 0);
    await s.context.close();
  }
  const denied = await setup({ allowed: false }); await denied.login(); await denied.page.goto(`${base}/profile`);
  await denied.page.getByLabel('Nome', { exact: true }).waitFor();
  assert.equal(await denied.page.locator('.push-settings').count(), 0); assert.equal(denied.requests.length, 0);
  await denied.context.close();
  console.log('PASS HTTP/denied/unconfigured states and unchanged access permissions');

  const deep = await setup();
  await deep.page.goto(`${base}/services/7?tab=team&day=2026-09-25&push=1`);
  await deep.page.waitForURL('**/login'); await deep.login();
  await deep.page.waitForURL((url) => url.pathname === '/services/7' && !url.search.includes('push=1'));
  await deep.page.getByText('Evento Push', { exact: true }).first().waitFor();
  assert.match(await deep.page.locator('.service-day-tabs .service-tab--active').innerText(), /25/);
  assert.ok(await deep.page.getByRole('button', { name: /Adicionar Colaborador/ }).count() > 0 || await deep.page.getByText('Funções deste dia', { exact: true }).isVisible());
  await deep.context.close();
  console.log('PASS push deep link through login returns to service/team/day');

  const session = await setup(); await session.login(); await session.profile();
  await session.page.getByRole('button', { name: 'Ativar neste dispositivo' }).click();
  await session.page.getByText('Notificações ativas neste dispositivo.', { exact: true }).waitFor();
  await session.page.evaluate(async () => { const { clearStoredAuth } = await import('/src/utils/api.js'); clearStoredAuth(); });
  await session.page.waitForURL('**/login');
  assert.equal(await session.page.evaluate(() => Boolean(localStorage.getItem('test-push-sub'))), true);
  session.changeUser({ ...user, id: 2 }); await session.login();
  assert.equal(await session.page.evaluate(() => Boolean(localStorage.getItem('test-push-sub'))), false);
  assert.equal(await session.page.evaluate(async () => Boolean(await (await caches.open('extrasolutio-push-settings')).match('/__push-owner'))), false);
  await session.context.close();
  console.log('PASS session expiry preserves subscription; account switch removes private binding');
  const logout = await setup(); await logout.login(); await logout.profile();
  await logout.page.getByRole('button', { name: 'Ativar neste dispositivo' }).click();
  await logout.page.getByText('Notificações ativas neste dispositivo.', { exact: true }).waitFor();
  await logout.page.getByRole('button', { name: 'Sair', exact: true }).click();
  await logout.page.waitForURL('**/login');
  await logout.page.waitForFunction(() => !localStorage.getItem('test-push-sub'));
  assert.equal(await logout.page.evaluate(async () => Boolean(await (await caches.open('extrasolutio-push-settings')).match('/__push-owner'))), false);
  await logout.login(); await logout.profile();
  await logout.page.getByRole('button', { name: 'Ativar neste dispositivo' }).waitFor();
  await logout.context.close();
  console.log('PASS explicit logout unsubscribes; subsequent login can opt in again');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
