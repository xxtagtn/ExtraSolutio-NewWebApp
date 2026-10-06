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
  return { context, page, update: (next) => { current = next; }, expire: () => { expired = true; } };
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
  const columns = await page.locator('.qr-consultation-record--compact .qr-check-details').evaluateAll((records) => records
    .filter((record) => record.checkVisibility()).map((record) => {
      const values = [...record.children].slice(0, 3).map((row) => row.querySelector('dd').getBoundingClientRect().top);
      return Math.max(...values) - Math.min(...values);
    }));
  assert.ok(columns.every((difference) => difference <= 1), `${width}px compact recorded-hour values stay aligned`);
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
  assert.equal(await completed.getByText('Horas trabalhadas', { exact: true }).count(), 2);
  assert.doesNotMatch(await completed.innerText(), /Intervalo/);
  assert.doesNotMatch(await completed.innerText(), /Validação|Validado|Por validar|Horário validado/);
  assert.match(await completed.locator('.qr-consultation-record').first().innerText(), /Horário previsto[\s\S]*08:00 → 16:00[\s\S]*Horário de picagem[\s\S]*08:02[\s\S]*16:05/);
  await upcoming.locator('summary').click();
  assert.match(await upcoming.innerText(), /Proximo evento/);
  assert.equal(await upcoming.locator('.qr-check-details, button').count(), 0, 'Future details do not present empty recorded hours or punch controls');
  assert.match(await upcoming.innerText(), /Horário previsto[\s\S]*22:00 → 02:00/);
  assert.equal(await upcoming.getByText('Horário de picagem', { exact: true }).count(), 0);
  assert.match(await upcoming.locator('.qr-month-renewal-note').innerText(), /novo link mensal/);
  for (const width of [1280, 390, 360, 320]) {
    await layout(test.page, width, '.qr-check-card');
    await test.page.screenshot({ path: join(output, `monthly-qr-${width}.png`), fullPage: true });
  }
  await test.page.getByRole('button', { name: 'Copiar resumo' }).click();
  const copied = await test.page.evaluate(() => window.copiedQr);
  assert.match(copied, /Dia: 05\/10\/2026/);
  assert.match(copied, /Servico da tarde/);
  assert.match(copied, /Horas trabalhadas: 8:03h/);
  assert.doesNotMatch(copied, /Intervalo/);
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

  const checkout = { ...active, services: [{ ...active.services[0], checkIn: '08:02',
    state: { key: 'entrada_registada', label: 'Entrada registada', nextAction: 'check_out' },
    checkOutRetryAfterMs: 1800000, checkOutAvailableTime: '08:32' }] };
  const blockedCheckout = await contextFor({ ...payload, activeDay: '2026-10-06', active: checkout, readOnly: false });
  const exitButton = blockedCheckout.page.getByRole('button', { name: 'Dar Saída', exact: true });
  await exitButton.waitFor();
  assert.equal(await exitButton.isDisabled(), true, 'The existing 30-minute checkout protection remains intact');
  assert.match(await blockedCheckout.page.locator('.qr-month-active').innerText(), /08:32.*30 minutos/s);
  for (const width of [320, 390, 1280]) await layout(blockedCheckout.page, width, '.qr-check-card');
  await blockedCheckout.context.close();

  const manyServices = Array.from({ length: 25 }, (_, index) => ({ ...service, assignmentId: 100 + index,
    assignmentDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
    eventName: index === 6 ? 'Receção da Embaixada' : `Evento do dia ${index + 1}` }));
  manyServices.push({ ...manyServices[4], assignmentId: 200, eventName: 'Segundo turno', checkIn: '17:00', checkOut: '20:00' });
  const manyUpcoming = Array.from({ length: 6 }, (_, index) => ({ ...history[2], assignmentId: 300 + index,
    assignmentDate: `2026-10-${index + 26}`, eventName: `Futuro ${index + 26}` }));
  const manyPayload = { ...payload, activeDay: '2026-10-06', active, readOnly: false, services: [...manyServices, ...manyUpcoming] };
  const compact = await contextFor(manyPayload);
  const compactHistory = compact.page.getByRole('region', { name: 'Horários realizados', exact: true });
  const compactUpcoming = compact.page.getByRole('region', { name: 'Próximos serviços', exact: true });
  await compactHistory.locator('details').first().waitFor();
  assert.equal(await compactHistory.locator('details').count(), 5);
  assert.equal(await compactUpcoming.locator('details').count(), 5);
  await compactUpcoming.getByRole('button', { name: 'Página seguinte' }).click();
  assert.equal(await compactUpcoming.locator('details').count(), 1);
  assert.match(await compactUpcoming.innerText(), /31\/10\/2026/);
  await compactUpcoming.getByRole('button', { name: 'Página anterior' }).click();
  assert.match(await compactHistory.innerText(), /1–5 de 25 dias/);
  const historyNavigation = compactHistory.getByRole('navigation');
  assert.equal(await historyNavigation.getByRole('button', { name: 'Página anterior' }).isDisabled(), true);
  await compactHistory.locator('summary').first().click();
  await compactHistory.locator('summary').nth(1).click();
  assert.equal(await compactHistory.locator('details[open]').count(), 1);
  assert.match(await compactHistory.locator('details[open]').innerText(), /02\/10\/2026/);
  await compactUpcoming.locator('summary').first().click();
  assert.equal(await compactHistory.locator('details[open]').count(), 0, 'Only one day can be open across both sections');
  await compactHistory.locator('summary').nth(4).focus();
  await compact.page.keyboard.press('Enter');
  assert.equal(await compactUpcoming.locator('details[open]').count(), 0);
  assert.equal(await compactHistory.locator('details[open] .qr-consultation-record').count(), 2);
  assert.match(await compactHistory.locator('details[open] summary').innerText(), /11:03h/);
  await compact.page.getByRole('button', { name: 'Copiar resumo do mês', exact: true }).click();
  const completeCopy = await compact.page.evaluate(() => window.copiedQr);
  assert.match(completeCopy, /Dia: 25\/10\/2026/);
  assert.match(completeCopy, /Segundo turno/);
  assert.doesNotMatch(completeCopy, /Futuro|Validação:/);
  for (let index = 0; index < 4; index += 1) await historyNavigation.getByRole('button', { name: 'Página seguinte' }).click();
  assert.match(await compactHistory.innerText(), /21–25 de 25 dias/);
  assert.equal(await compactHistory.locator('details[open]').count(), 0);
  assert.equal(await historyNavigation.getByRole('button', { name: 'Página seguinte' }).isDisabled(), true);
  assert.equal(await compact.page.getByRole('button', { name: 'Dar Entrada', exact: true }).isVisible(), true, 'Paging does not hide the punch action');
  const searchInput = compactHistory.getByRole('searchbox', { name: 'Pesquisar evento ou dia' });
  await searchInput.fill('RECECAO');
  assert.equal(await compactHistory.locator('details').count(), 1);
  assert.match(await compactHistory.innerText(), /07\/10\/2026/);
  await compactHistory.locator('summary').click();
  await compact.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await compact.page.waitForTimeout(250);
  assert.equal(await searchInput.inputValue(), 'RECECAO');
  assert.equal(await compactHistory.locator('details[open]').count(), 1, 'Silent refresh preserves the open day');
  await searchInput.fill('25/10/2026');
  assert.match(await compactHistory.innerText(), /25\/10\/2026/);
  await compact.page.getByRole('button', { name: 'Resumo copiado', exact: true }).click();
  assert.equal(await compact.page.evaluate(() => window.copiedQr), completeCopy, 'Search and pagination never restrict monthly copy');
  await searchInput.fill('nenhum evento');
  assert.equal(await compactHistory.locator('details').count(), 0);
  assert.match(await compactHistory.innerText(), /Sem resultados/);
  await compactHistory.getByRole('button', { name: 'Limpar pesquisa' }).click();
  assert.equal(await compactHistory.locator('details').count(), 5);
  await compactHistory.locator('summary').nth(4).click();
  for (const width of [1280, 390, 360, 320]) {
    await layout(compact.page, width, '.qr-check-card');
    await compact.page.screenshot({ path: join(output, `monthly-qr-compact-${width}.png`), fullPage: true });
  }
  await historyNavigation.getByRole('button', { name: 'Página seguinte' }).click();
  compact.update({ ...manyPayload, services: [manyServices[0]] });
  await compact.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await compact.page.waitForFunction(() => document.querySelector('[aria-label="Horários realizados"] .qr-month-pagination')?.textContent.includes('1–1 de 1 dia'));
  assert.equal(await compactHistory.locator('details').count(), 1, 'Pagination clamps after services change');
  await compact.context.close();

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
  console.log('Monthly QR UI passed: active punches, read-only history, compact pagination/search, single keyboard-accessible accordion, stable refresh, full monthly copy, expired link, monthly QR dialog, event filtering and 1280/390/360/320px. All API requests intercepted.');
} finally {
  await browser.close();
}
