import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = 5198, base = 'http://127.0.0.1:' + port;
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
const clients = [{ id: 1, name: 'Cliente QA A' }, { id: 2, name: 'Cliente QA B' }];
const events = Array.from({ length: 23 }, (_, index) => {
  const id = index + 1, day = '2026-11-0' + (index % 3 + 1), client = clients[index < 12 ? 0 : 1];
  return {
    id, name: 'Evento finalizado ' + id, date: day, clientId: client.id, client,
    status: 'finalized', statusMode: 'manual', startTime: '08:00', endTime: '12:00',
    assignments: [1, 2].map((person) => ({
      id: id * 10 + person, eventId: id, collaboratorId: person, collaborator: { id: person, name: 'Pessoa QA ' + person },
      role: 'Emp.Mesa', assignmentDate: day, status: 'confirmed', validationStatus: 'validated',
      checkIn: '08:00', checkOut: '12:00', clientCheckIn: '08:00', clientCheckOut: '12:00',
    })),
  };
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, timezoneId: 'Europe/Lisbon' });
    const writes = [], errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-03T12:00:00Z') });
    await page.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'finalized-pagination',
    })));
    await page.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === base ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? events : url.pathname === '/api/clients' ? clients : [] });
    });
    await page.goto(base + '/time-validation');
    const nav = page.getByRole('navigation', { name: 'Paginação dos eventos finalizados' });
    assert.equal(await nav.count(), 0);
    await page.getByRole('tab', { name: /Finalizados/ }).click();
    await nav.waitFor();
    const items = page.locator('.validation-history-item');
    const names = () => items.locator(':scope > div:first-child > strong').allTextContents();
    assert.equal(await items.count(), 10);
    const first = await names();
    await nav.getByRole('button', { name: 'Página seguinte' }).click();
    assert.equal(await items.count(), 10);
    assert.equal((await names()).some((name) => first.includes(name)), false);
    await nav.getByRole('button', { name: 'Página 3', exact: true }).click();
    assert.equal(await items.count(), 3);
    assert.equal(await nav.getByRole('button', { name: 'Página seguinte' }).isDisabled(), true);
    await items.first().getByRole('button', { name: 'Ver horários' }).click();
    assert.equal(await items.first().locator('tbody tr').count(), 2);
    await page.locator('.validation-filters select').first().selectOption({ label: 'Cliente QA A' });
    assert.equal(await nav.getByRole('button', { name: 'Página 1', exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await items.count(), 10);
    await page.getByLabel('Por página').selectOption('25');
    assert.equal(await items.count(), 12);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.goto(base + '/time-validation?eventId=23');
    await items.getByText('Evento finalizado 23', { exact: true }).waitFor();
    assert.equal(await items.count(), 1);
    assert.equal(await items.first().locator('tbody tr').count(), 2);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await page.close();
    console.log('Finalizados: pagination, filters, expanded schedules and direct link passed at ' + width + 'px.');
  }
} finally { await browser?.close(); await server.close(); }
