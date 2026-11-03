import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import XLSX from 'xlsx-js-style';
import { unzipSync, strFromU8 } from 'fflate';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = 5197;
const base = 'http://127.0.0.1:' + port;
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
const now = new Date('2026-11-03T12:00:00Z');
const client = { id: 1, name: 'BLANK', billingMethod: 'monthly', paymentTerm: 'days_15', status: 'active' };
const events = [1, 2, 3].map((id) => {
  const day = '2026-10-' + (27 + id);
  return {
    id, clientId: 1, client, name: 'Evento QA ' + id, date: day, status: 'finalized',
    billingStatus: 'paid', billingPaymentDate: '2026-11-02', totalRevenue: 123, taxAmount: 23, paidAmount: 123,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 10 }], externalCosts: [], invoices: [],
    assignments: [{ id, collaboratorId: id, collaborator: { id, name: 'Pessoa QA ' + id }, role: 'Emp.Mesa', status: 'confirmed',
      assignmentDate: day, checkIn: '18:00', checkOut: '03:00', clientCheckIn: '18:00', clientCheckOut: '04:00',
      validationStatus: id === 3 ? 'pending' : 'validated' }],
  };
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [390, 1536]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 }, timezoneId: 'Europe/Lisbon', acceptDownloads: true });
    const writes = [], errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.addInitScript((lastActivityAt) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt, sessionId: 'archive-excel',
    })), now.getTime());
    await page.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === base ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? events : url.pathname === '/api/clients' ? [client] : [] });
    });
    await page.goto(base + '/finance?area=archive');
    await page.locator('.finance-client-row').filter({ hasText: 'BLANK' }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Selecionar Evento QA 3', exact: true }).count(), 0);
    const check = (id) => page.getByRole('checkbox', { name: 'Selecionar Evento QA ' + id, exact: true });
    await check(1).check();
    assert.equal(await page.locator('.finance-archive-selection input').evaluate((input) => input.indeterminate), true);
    await check(2).check();
    await page.screenshot({ path: 'node_modules/.cache/archive-event-excel-' + width + '.png', fullPage: true });
    const download = async (button) => {
      const pending = page.waitForEvent('download');
      await button.click();
      const file = await pending;
      assert.match(file.suggestedFilename(), /\.xlsx$/);
      const content = await readFile(await file.path());
      const xml = unzipSync(content);
      assert.match(strFromU8(xml['xl/worksheets/sheet1.xml']), /orientation="landscape"[^>]*fitToWidth="1"[^>]*fitToHeight="0"/);
      assert.match(strFromU8(xml['xl/styles.xml']), /595959/);
      const workbook = XLSX.read(content, { type: 'buffer' });
      assert.equal(workbook.SheetNames.length, 1);
      return workbook;
    };
    const workbook = await download(page.getByRole('button', { name: 'Exportar 2 eventos', exact: true }));
    const summary = workbook.Sheets['Resumo dos eventos'];
    assert.equal(summary.A4.v, 'Evento QA 1'); assert.equal(summary.A5.v, 'Evento QA 2');
    assert.equal(summary.G6.v, 246); assert.equal(summary.H6.v, 246); assert.equal(summary.I6.v, 0);
    assert.equal(summary.K6.v, 200); assert.equal(summary.L6.v, 46);
    assert.equal(summary.A8.v, 'HORÁRIOS VALIDADOS');
    assert.equal(summary.G12.v * 24, 18); assert.equal(summary.J12.v * 24, 20);
    assert.equal(summary.G12.f, 'SUBTOTAL(109,G10:G11)');
    assert.equal(summary['!autofilter'].ref, 'A9:K11');
    assert.equal(summary.B16.v, 246);
    const one = await download(page.getByRole('button', { name: 'Exportar Excel: Evento QA 2' }));
    const single = one.Sheets['Resumo do evento'];
    assert.equal(single.A2.v, 'Evento QA 2');
    assert.equal(single.G5.v, 123);
    assert.equal(single.A7.v, 'HORÁRIOS VALIDADOS');
    assert.equal(single.A9.v, 'Pessoa QA 2');
    assert.equal(single['!autofilter'].ref, 'A8:J9');
    assert.equal(single.B14.v, 123);
    await page.getByRole('button', { name: 'Limpar seleção' }).click();
    assert.equal(await page.getByRole('button', { name: 'Exportar 2 eventos', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await page.close();
    console.log('Archive Excel download, eligible selection and workbook totals passed at ' + width + 'px.');
  }
} finally { await browser?.close(); await server.close(); }
