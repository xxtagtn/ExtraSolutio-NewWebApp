import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.argv[3] || 'playwright');
const output = process.argv[2];
if (!output) throw new Error('Provide a screenshot output directory.');
await mkdir(output, { recursive: true });
const baseUrl = process.env.QR_UI_URL || 'http://localhost:5175';
const expiry = '2026-11-14T23:59:59.999Z';
const punchExpiresAt = '2026-10-31T23:59:59.999Z';
const service = { assignmentId: 1, assignmentDate: '2026-10-05', eventName: 'Embaixada da Republica Popular da China',
  role: 'Emp. Mesa', checkIn: '08:02', checkOut: '16:05', startTime: '08:00', endTime: '16:00',
  validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '16:00', readOnly: true, upcoming: false };
const history = [service, { ...service, assignmentId: 2, eventName: 'Servico da tarde', role: 'Bar', checkIn: '17:00', checkOut: '', validationStatus: 'pending' },
  { ...service, assignmentId: 3, assignmentDate: '2026-10-31', eventName: 'Proximo evento', checkIn: '', checkOut: '', upcoming: true, readOnly: false,
    startTime: '22:00', endTime: '02:00', requiresNewLinkForCheckout: true }];
const payload = { scope: 'month', collaboratorName: 'Ana Cristina Rosa', consultationExpiresAt: expiry, punchExpiresAt, consultationOnly: false,
  timeZone: 'Europe/Lisbon', historyFrom: '2026-10-01', active: null, readOnly: true, services: history };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let writes = 0;

async function contextFor(monthly, admin = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(({ admin }) => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text) => { window.copiedQr = text; } } });
    if (admin) localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'isolated-ui-test',
      user: { id: 1, name: 'Teste', role: 'admin' }, sessionId: 'test', lastActivityAt: Date.now() }));
  }, { admin });
  let current = monthly;
  let expired = false;
  const groups = [
    { collaboratorId: 1, collaboratorName: 'Ana Cristina Rosa', qrScope: 'month', qrUrl: 'https://example.test/qr/month/month1.test', expiresAt: expiry, punchExpiresAt, services: history },
    { collaboratorId: 2, collaboratorName: 'Outro colaborador', qrScope: 'month', qrUrl: 'https://example.test/qr/month/month1.other', expiresAt: expiry, punchExpiresAt, services: [service] },
  ];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');
    if (route.request().method() !== 'GET') {
      writes += 1;
      assert.equal(path, '/qr-check/month/ui-test/check-in');
      assert.deepEqual(route.request().postDataJSON(), { assignmentId: 10, revision: 'test-revision' });
      current = payload;
      return route.fulfill({ json: current });
    }
    if (path === '/qr-check/month/ui-test') return route.fulfill({ status: expired ? 410 : 200,
      json: expired ? { message: 'O prazo de consulta deste link terminou. Pede o novo link mensal.' } : current });
    if (path === '/qr-codes/monthly/events') return route.fulfill({ json: [{ id: 1, name: service.eventName }] });
    if (path === '/qr-codes/monthly') {
      const items = url.searchParams.get('eventId') ? groups.slice(0, 1) : groups;
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 25, totalPages: 1, expiresAt: expiry, punchExpiresAt,
        summary: { total: items.length, services: 4, entries: 2, completed: 1 } } });
    }
    if (path === '/communication/tasks') return route.fulfill({ json: { items: [], events: [], total: 0 } });
    return route.fulfill({ json: [] });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}${admin ? '/communication' : '/qr/month/ui-test'}`);
  return { context, page, expire: () => { expired = true; } };
}

async function layout(page, width, selector) {
  await page.setViewportSize({ width, height: 1000 });
  const openMenu = page.locator('.sidebar--open .sidebar-close');
  if (width <= 900 && await openMenu.count()) await openMenu.click();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const result = await page.locator(selector).evaluate((root) => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    problems: [...root.querySelectorAll('h1, h2, p, dt, dd, button, small, strong, .badge, .communication-qr-service__schedule')]
      .filter((element) => {
        if (!element.checkVisibility()) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth || rect.left < 0 || (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2);
      })
      .map((element) => element.textContent),
  }));
  assert.equal(result.overflow, false, `${width}px page overflow`);
  assert.deepEqual(result.problems, [], `${width}px clipped text`);
}

try {
  const test = await contextFor(payload);
  const upcoming = test.page.getByRole('region', { name: 'Próximos serviços', exact: true });
  const completed = test.page.getByRole('region', { name: 'Horários realizados', exact: true });
  await completed.waitFor();
  assert.equal(await test.page.locator('.qr-check-command').count(), 0);
  assert.equal(await test.page.locator('.qr-month-day').count(), 2);
  await completed.locator('summary').click();
  assert.equal(await completed.locator('.qr-month-day[open] .qr-consultation-record').count(), 2);
  await upcoming.locator('summary').click();
  assert.match(await upcoming.innerText(), /Proximo evento/);
  assert.equal(await upcoming.locator('dl, button').count(), 0, 'Future details do not present empty recorded hours or punch controls');
  assert.match(await upcoming.locator('.qr-month-renewal-note').innerText(), /novo link mensal/);
  for (const width of [1280, 390, 360, 320]) {
    await layout(test.page, width, '.qr-check-card');
    await test.page.screenshot({ path: join(output, `monthly-qr-${width}.png`), fullPage: true });
  }
  await test.page.getByRole('button', { name: 'Copiar resumo' }).click();
  const copied = await test.page.evaluate(() => window.copiedQr);
  assert.match(copied, /Dia: 05\/10\/2026/);
  assert.match(copied, /Servico da tarde/);
  assert.doesNotMatch(copied, /Proximo evento/);
  assert.doesNotMatch(copied, /Validação:|Por validar/);
  test.expire();
  await test.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await test.page.locator('.qr-check-empty--error').waitFor();
  assert.equal(await test.page.locator('.qr-month-history, .qr-check-command, a[href*="month1"]').count(), 0);
  await test.context.close();

  const consultation = await contextFor({ ...payload, consultationOnly: true,
    services: history.filter((row) => !row.upcoming).map((row) => ({ ...row, readOnly: true })) });
  await consultation.page.getByRole('heading', { name: 'Horários realizados' }).waitFor();
  assert.equal(await consultation.page.locator('.qr-check-command').count(), 0);
  assert.match(await consultation.page.locator('.qr-check-header').innerText(), /Apenas consulta.*14\/11\/2026/s);
  assert.equal(await consultation.page.getByRole('region', { name: 'Próximos serviços', exact: true }).locator('details').count(), 0);
  await consultation.page.getByRole('region', { name: 'Horários realizados', exact: true }).locator('summary').click();
  await layout(consultation.page, 390, '.qr-check-card');
  await consultation.page.screenshot({ path: join(output, 'monthly-qr-consultation-390.png'), fullPage: true });
  await consultation.context.close();

  const active = { scope: 'day', assignmentDate: '2026-10-06', collaboratorName: payload.collaboratorName,
    services: [{ ...service, assignmentId: 10, checkIn: '', checkOut: '', readOnly: false, expired: false,
      state: { key: 'qr_generated', label: 'QR Gerado', nextAction: 'check_in' } }], candidateIds: [10],
    activeAssignmentId: 10, completedCount: 0, total: 1, revision: 'test-revision' };
  const activeTest = await contextFor({ ...payload, activeDay: '2026-10-06', active, readOnly: false });
  await activeTest.page.locator('.qr-check-command').waitFor();
  for (const width of [390, 320, 1280]) await layout(activeTest.page, width, '.qr-check-card');
  await activeTest.page.locator('.qr-check-command').click();
  await activeTest.page.waitForFunction(() => !document.querySelector('.qr-check-command'));
  await activeTest.context.close();

  const admin = await contextFor(null, true);
  await admin.page.getByRole('button', { name: 'QR Codes / Link', exact: true }).click();
  const table = admin.page.locator('.communication-qr-table');
  await table.locator('tbody tr').first().getByRole('button', { name: 'Copiar Link de Ana Cristina Rosa' }).waitFor();
  assert.equal(await table.locator('tbody tr').count(), 2);
  await table.locator('details summary').first().click();
  assert.equal(await table.locator('details[open] .communication-qr-service').count(), 3);
  for (const width of [1280, 390, 360, 320]) {
    await layout(admin.page, width, '.communication-qr-panel');
    await admin.page.screenshot({ path: join(output, `monthly-communication-${width}.png`), fullPage: true });
  }
  await admin.page.getByRole('button', { name: 'Copiar Link de Ana Cristina Rosa' }).click();
  assert.equal(await admin.page.evaluate(() => window.copiedQr), 'https://example.test/qr/month/month1.test');
  await admin.page.getByRole('button', { name: 'Ver QR Code de Ana Cristina Rosa' }).click();
  const dialog = admin.page.getByRole('dialog');
  await dialog.locator('img').waitFor();
  assert.match(await dialog.innerText(), /Link mensal/);
  assert.match(await dialog.innerText(), /picagens até 31\/10\/2026.*consulta até 14\/11\/2026/s);
  assert.equal(await dialog.locator('code').innerText(), 'https://example.test/qr/month/month1.test');
  await layout(admin.page, 320, '.communication-qr-dialog');
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await admin.page.locator('.communication-qr-toolbar select').selectOption('1');
  await admin.page.waitForFunction(() => document.querySelectorAll('.communication-qr-table tbody tr').length === 1);
  await admin.context.close();
  assert.equal(writes, 1, 'Only the intercepted entry test may issue a POST');
  assert.deepEqual(errors, []);
  console.log('Monthly QR UI passed: active punches, read-only history, day accordions, copy summary/link, expired link, monthly QR dialog, event filtering and 1280/390/360/320px. All API requests intercepted.');
} finally {
  await browser.close();
}
