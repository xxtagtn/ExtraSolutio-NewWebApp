// All API traffic is simulated, including saves. No production records are accessed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildClientFinanceSnapshot } from '../src/utils/clientFinanceSnapshot.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const output = 'node_modules/.cache/billing-adjustment-vat';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) for (const rate of [23, 0]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'test-only',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: new Date('2026-10-20T12:00:00Z').getTime(), sessionId: 'adjustment-vat' })));
    const client = { id: 1, name: 'FIC QA', billingMethod: 'monthly', paymentTerm: 'days_15', status: 'active' };
    const event = { id: 10, name: 'FIC RESTAURANTE QA', date: '2026-10-16', status: 'finalized', client, clientId: 1,
      totalRevenue: rate ? 3130.35 : 2545, taxAmount: rate ? 585.35 : 0, staffVatRateSnapshot: rate,
      vatRateSnapshot: 23, billingAdjustment: 0, billingStatus: 'pending', assignments: [],
      requiredRoles: [{ role: 'Bar', qty: 1, agreedRate: 10 }], paidAmount: 0, updatedAt: '2026-10-20T12:00:00Z' };
    const payload = () => ({ ...event, clientFinance: buildClientFinanceSnapshot(event) });
    let writes = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      if (request.method() !== 'GET') {
        assert.equal(path, '/services/10'); assert.equal(request.method(), 'PUT');
        const input = request.postDataJSON(); assert.deepEqual(input, { billingAdjustment: 5 });
        event.billingAdjustment = input.billingAdjustment; writes++;
        return route.fulfill({ json: payload() });
      }
      return route.fulfill({ json: path === '/services' ? [payload()] : path === '/services/10' ? payload()
        : path === '/clients' ? [client] : path === '/notifications/overview' ? { notifications: { total: 0, items: [], allItems: [] }, reminders: [] } : [] });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
    await page.goto(`${base}/finance?area=clients`);
    const workspace = page.locator('.finance-client-workspace');
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    const row = workspace.locator('.finance-client-event-row').filter({ hasText: event.name });
    const input = row.getByLabel(`Ajuste de faturação de ${event.name}`);
    await input.fill('5');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/services/10') && response.request().method() === 'PUT'),
      input.press('Enter'),
    ]);
    await row.locator('.finance-client-outstanding small').getByText(rate ? /2\s?550,00.*586,50.*IVA/ : /2\s?550,00.*0,00.*IVA/).waitFor();
    assert.equal(writes, 1);
    await row.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click();
    const manager = page.getByRole('dialog');
    await manager.locator('[data-payment-metric="total"]').waitFor();
    assert.match(await manager.locator('[data-payment-metric="total"]').innerText(), /2550,00|2\s?550,00/);
    assert.match(await manager.locator('[data-payment-metric="outstanding"]').innerText(), rate ? /3136,50|3\s?136,50/ : /2550,00|2\s?550,00/);
    assert.match(await manager.innerText(), rate ? /5,00.*1,15.*IVA/ : /5,00.*0,00.*IVA/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await manager.screenshot({ path: `${output}/manager-${rate}-${width}.png` });
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.reload();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    await row.locator('.finance-client-outstanding small').getByText(rate ? /2\s?550,00.*586,50.*IVA/ : /2\s?550,00.*0,00.*IVA/).waitFor();
    assert.equal(await input.inputValue(), '+5,00');
    assert.equal(writes, 1);
    assert.deepEqual(errors, []);
    await row.screenshot({ path: `${output}/row-${rate}-${width}.png` });
    await context.close();
    console.log(`Inherited ${rate}% VAT, save, receipt manager and reload passed at ${width}px`);
  }
} finally { await browser.close(); }
