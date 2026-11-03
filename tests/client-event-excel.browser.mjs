import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import XLSX from 'xlsx-js-style';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = 5198, base = 'http://127.0.0.1:' + port;
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
const client = { id: 1, name: 'Cliente QA', billingMethod: 'monthly', paymentTerm: 'days_15', status: 'active' };
const events = [1, 2, 3].map((id) => ({
  id, clientId: 1, client, name: 'Evento QA ' + id, date: '2026-11-01', status: 'finalized', statusMode: 'manual',
  billingStatus: 'pending', totalRevenue: 123, taxAmount: 23, paidAmount: 0, staffVatRateSnapshot: 23,
  requiredRoles: [], externalCosts: [],
  assignments: [{ id, collaboratorId: id, collaborator: { id, name: 'Pessoa QA ' + id }, role: 'Emp.Mesa',
    status: 'confirmed', assignmentDate: '2026-11-01', checkIn: '08:00', checkOut: '12:00',
    clientCheckIn: '08:00', clientCheckOut: '12:00', validationStatus: id === 2 ? 'pending' : 'validated' }],
}));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [320, 1536]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 }, timezoneId: 'Europe/Lisbon', acceptDownloads: true });
    const writes = [], errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-03T12:00:00Z') });
    await page.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'client-excel',
    })));
    await page.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === base ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? events : url.pathname === '/api/clients' ? [client] : [] });
    });
    await page.goto(base + '/finance?area=clients');
    await page.locator('.finance-client-summary-row').filter({ hasText: 'Cliente QA' }).click();
    const bar = page.locator('.finance-client-export-selection');
    const check = (id) => page.getByRole('checkbox', { name: 'Selecionar Evento QA ' + id, exact: true });
    assert.equal(await check(1).count(), 0);
    await page.getByRole('button', { name: 'Selecionar eventos', exact: true }).click();
    assert.equal(await bar.count(), 0);
    await check(1).check();
    await bar.getByText('1 evento selecionado', { exact: true }).waitFor();
    await check(1).uncheck();
    assert.equal(await bar.count(), 0);
    await check(1).check(); await check(2).check();
    await bar.getByText('2 eventos selecionados', { exact: true }).waitFor();
    const pending = page.waitForEvent('download');
    await bar.getByRole('button', { name: 'Exportar 2 eventos', exact: true }).click();
    const file = await pending;
    const workbook = XLSX.read(await readFile(await file.path()), { type: 'buffer' });
    const sheet = workbook.Sheets['Resumo dos eventos'];
    assert.equal(sheet.A2.v, '2 eventos selecionados');
    assert.equal(sheet.A4.v, 'Evento QA 1'); assert.equal(sheet.A5.v, 'Evento QA 2');
    assert.equal(sheet.G6.v, 246); assert.equal(sheet.H6.v, 0); assert.equal(sheet.I6.v, 246);
    assert.equal(sheet.B10.v, 'Pessoa QA 1');
    assert.equal(sheet['!autofilter'].ref, 'A9:K10');
    await bar.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await bar.count(), 0); assert.equal(await check(1).count(), 0);
    await page.getByRole('button', { name: 'Selecionar eventos', exact: true }).click();
    await check(1).check();
    await page.locator('.finance-client-filter select').selectOption('client:1');
    assert.equal(await bar.count(), 0); assert.equal(await check(1).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await page.close();
    console.log('Client Excel: hidden bar, selection, validated hours and recorded balances passed at ' + width + 'px.');
  }
} finally { await browser?.close(); await server.close(); }
