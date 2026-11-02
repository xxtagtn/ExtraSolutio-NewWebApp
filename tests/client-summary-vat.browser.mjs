// Simulated read-only APIs. No real events, receipts or financial records are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/client-summary-vat';
await mkdir(output, { recursive: true });
const now = new Date('2026-11-02T12:00:00Z');
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
const compact = (value) => value.replace(/\s/g, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 768, 1440, 1920]) {
    const clients = [
      { id: 1, name: 'BLANK', billingMethod: 'per_event', paymentTerm: 'immediate' },
      { id: 2, name: 'FIC RESTAURANTE', billingMethod: 'biweekly', paymentTerm: 'days_15' },
      { id: 3, name: 'SUPREME', billingMethod: 'monthly', paymentTerm: 'days_30' },
    ].map((client) => ({ status: 'active', ...client }));
    const services = [
      { id: 1, clientId: 1, totalRevenue: 123, taxAmount: 23 },
      { id: 2, clientId: 1, totalRevenue: 80, taxAmount: 0 },
      { id: 3, clientId: 2, totalRevenue: 286, taxAmount: 36 },
      { id: 4, clientId: 2, totalRevenue: 120, taxAmount: 20, billingStatus: 'invoiced' },
      { id: 5, clientId: 3, totalRevenue: 3130.35, taxAmount: 585.35, billingAdjustment: 5, staffVatRateSnapshot: 23 },
    ].map((event) => ({ name: `Serviço ${event.id}`, date: '2026-11-01', status: 'finalized', statusMode: 'manual',
      requiredRoles: [], assignments: [], externalCosts: [], paidAmount: 0, billingStatus: 'pending',
      clientPaymentRecord: { version: 1, entries: [], financeWorkflowVersion: 2 },
      ...event, client: clients.find((client) => client.id === event.clientId) }));
    const original = structuredClone({ clients, services });
    const writes = [], errors = [];
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'summary-vat-test', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'summary-vat-test',
    })), now.getTime());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? services : url.pathname === '/api/clients' ? clients : [] });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.goto(`${base}/finance?area=clients`);
    const workspace = page.locator('.finance-client-workspace');
    await workspace.locator('.finance-client-summary-row').first().waitFor();
    const pending = workspace.locator('.finance-client-summary-card--pending');
    const total = workspace.locator('.finance-client-summary-card--total');
    async function pair(element, net, gross) {
      assert.equal(compact(await element.locator('.finance-client-amount strong').textContent()), compact(money(net)));
      assert.equal(compact(await element.locator('.finance-client-amount small').textContent()), compact(`${money(gross)} c/ IVA`));
    }
    await pair(pending, 2980, 3625.5);
    await pair(total, 3080, 3745.5);
    const row = (name) => workspace.locator('.finance-client-summary-row').filter({ hasText: name });
    await pair(row('BLANK').locator('[data-label="Por faturar"]'), 180, 203);
    await pair(row('FIC RESTAURANTE').locator('[data-label="Por faturar"]'), 250, 286);
    await pair(row('FIC RESTAURANTE').locator('[data-label="Total do período"]'), 350, 406);
    await pair(row('SUPREME').locator('[data-label="Total do período"]'), 2550, 3136.5);
    assert.equal(await workspace.locator('[data-label="Faturado em aberto"] .finance-client-amount').count(), 0);
    const filter = workspace.locator('.finance-client-filter select');
    await filter.selectOption('client:2');
    await pair(pending, 250, 286); await pair(total, 350, 406);
    await filter.selectOption('all');
    await pair(total, 3080, 3745.5);
    const contained = await workspace.locator('.finance-client-amount').evaluateAll((items) => items.every((item) => {
      const base = item.querySelector('strong').getBoundingClientRect(), gross = item.querySelector('small').getBoundingClientRect();
      const box = item.getBoundingClientRect();
      return gross.top >= base.bottom && base.left >= box.left - 1 && base.right <= box.right + 1
        && gross.left >= box.left - 1 && gross.right <= box.right + 1;
    }));
    assert.equal(contained, true, 'Stacked amounts fit and never overlap');
    const colors = await pending.locator('.finance-client-amount').evaluate((item) => ({
      base: getComputedStyle(item.querySelector('strong')).color, gross: getComputedStyle(item.querySelector('small')).color,
    }));
    assert.equal(colors.base, 'rgb(238, 245, 243)'); assert.equal(colors.gross, 'rgb(251, 191, 36)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await workspace.screenshot({ path: `${output}/summary-${width}.png` });
    assert.deepEqual({ clients, services }, original);
    services[4].billingAdjustment = 10;
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/services');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await page.waitForFunction(() => document.querySelector('.finance-client-summary-card--total .finance-client-amount strong')?.textContent.replace(/\s/g, '') === '3085,00€');
    await pair(total, 3085, 3751.65);
    await page.reload();
    await workspace.locator('.finance-client-summary-row').first().waitFor();
    await pair(total, 3085, 3751.65);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await context.close();
    console.log(`Client summary VAT: actual mixed/exempt VAT, adjustment, filter, refresh, reload, colors and layout passed at ${width}px`);
  }
} finally { await browser.close(); }
