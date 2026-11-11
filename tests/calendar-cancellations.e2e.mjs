import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5198';
const now = new Date('2026-11-11T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({ timezoneId: 'Europe/Lisbon' });
  const services = [
    { id: 1, name: 'Serviço ativo', date: '2026-11-11' },
    { id: 2, name: 'Evento cancelado', date: '2026-11-11', status: 'cancelled', billingStatus: 'partial70', remainingPaymentDate: '2026-11-12' },
    { id: 3, name: 'Serviço contínuo', date: '2026-11-10', endDate: '2026-11-12', isContinuous: true, cancelledDays: '[{"date":"2026-11-11"}]' },
    { id: 4, name: 'Entre meses', date: '2026-11-30', endDate: '2026-12-02', isContinuous: true, cancelledDays: ['2026-12-01', '2026-12-02'] },
    { id: 5, name: 'Todos os dias cancelados', date: '2027-01-01', endDate: '2027-01-02', isContinuous: true, cancelledDays: ['2027-01-01', '2027-01-02'] },
  ];
  await context.addInitScript((lastActivityAt) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'calendar-qa', user: { id: 1, role: 'admin' }, lastActivityAt, sessionId: 'calendar-qa',
  })), now.getTime());
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    assert.equal(request.method(), 'GET');
    return route.fulfill({ json: url.pathname === '/api/services' ? services : [] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: now });
  await page.goto(`${base}/calendar`);
  const calendar = page.getByRole('region', { name: 'Calendário', exact: true });
  const service = (id) => calendar.locator(`a.calendar-event[href="/services/${id}"]`);
  await service(1).waitFor();
  assert.equal(await service(2).count(), 0);
  assert.equal(await service(3).count(), 2);
  assert.equal(await service(4).count(), 1);
  assert.equal(await calendar.getByRole('combobox', { name: 'Mês' }).locator('option[value="11"]').textContent(), 'Dezembro');
  assert.equal(await calendar.getByRole('combobox', { name: 'Ano' }).locator('option[value="2027"]').count(), 0);

  await calendar.getByRole('tab', { name: 'Semana' }).click();
  assert.equal(await service(3).count(), 2);
  assert.equal(await service(2).count(), 0);
  await calendar.getByRole('tab', { name: 'Dia', exact: true }).click();
  assert.equal(await service(1).count(), 1);
  assert.equal(await service(3).count(), 0);
  services[2].cancelledDays = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await service(3).waitFor();
  assert.deepEqual(errors, []);
  console.log('Calendar: cancelled services and days hidden in month/week/day, no phantom month/year, reactivation picked up on focus');
  await context.close();
} finally { await browser.close(); }
