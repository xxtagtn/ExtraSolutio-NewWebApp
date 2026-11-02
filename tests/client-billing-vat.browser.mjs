// Simulated read-only APIs. No production requests, cash movements or database writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/client-billing-vat'; await mkdir(output, { recursive: true });
const compact = (value) => value.replace(/\s/g, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 768, 1440, 1920]) {
    const client = { id: 1, name: 'BLANK', billingMethod: 'monthly', paymentTerm: 'days_15', status: 'active' };
    const events = [[976.5, 224.6], [126, 28.98], [157.5, 36.23]].map(([net, taxAmount], index) => ({
      id: index + 1, name: `Servico QA ${index + 1}`, clientId: 1,
      client: { ...client, billingMethod: 'per_event' }, // The current client file must win over an old nested value.
      date: `2026-10-${10 + index}`, status: 'finalized', statusMode: 'manual', staffVatRateSnapshot: 23,
      totalRevenue: Number((net + taxAmount).toFixed(2)), taxAmount, paidAmount: 0, billingStatus: 'pending',
      requiredRoles: [], assignments: [], externalCosts: [],
      clientPaymentRecord: { version: 1, entries: [], financeWorkflowVersion: 2 },
    }));
    const original = structuredClone(events), writes = [], errors = [], now = new Date('2026-11-02T12:00:00Z');
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'monthly-vat-qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'monthly-vat-qa' })), now.getTime());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? events : url.pathname === '/api/clients' ? [client] : [] });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.goto(`${base}/finance?area=clients&eventId=1`);
    const workspace = page.locator('.finance-client-workspace');
    const row = workspace.locator('.finance-client-summary-row').filter({ hasText: 'BLANK' }); await row.waitFor();
    async function pair(element, gross = '1549,80€c/IVA') {
      assert.equal(compact(await element.locator('.finance-client-amount strong').textContent()), '1260,00€');
      assert.equal(compact(await element.locator('.finance-client-amount small').textContent()), gross);
    }
    await pair(workspace.locator('.finance-client-summary-card--pending'));
    await pair(workspace.locator('.finance-client-summary-card--total'));
    await pair(row.locator('[data-label="Por faturar"]')); await pair(row.locator('[data-label="Total do período"]'));
    assert.match(await row.locator('[data-label="Total do período"] small').getAttribute('title'), /Arredondamento/);
    await row.click();
    const note = workspace.locator('.finance-client-vat-reconciliation'); await note.waitFor();
    assert.match(await note.textContent(), /IVA mensal/); assert.match(compact(await note.textContent()), /289,80€IVA/);
    assert.equal(compact(await note.locator('small').textContent()).endsWith('−0,01€'), true);
    assert.equal(await workspace.locator('.finance-client-event-row').count(), 3);
    assert.match(compact(await workspace.locator('.finance-client-event-row').first().textContent()), /1201,10€/);
    await workspace.screenshot({ path: `${output}/monthly-${width}.png` });
    const noteFits = await note.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll('*')].every((child) => {
        const rect = child.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
    });
    assert.equal(noteFits, true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await workspace.locator('.finance-client-filter select').selectOption('client:1');
    await pair(workspace.locator('.finance-client-summary-card--total')); await note.waitFor();
    await page.reload(); await row.waitFor(); await pair(workspace.locator('.finance-client-summary-card--total'));
    client.billingMethod = 'per_event';
    await page.reload(); await row.waitFor(); await pair(workspace.locator('.finance-client-summary-card--total'), '1549,81€c/IVA');
    await row.click(); assert.equal(await note.count(), 0);
    assert.deepEqual(events, original); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await context.close(); console.log(`Monthly VAT matches 1549.80; per-event remains 1549.81; client file/filter/reload/read-only/layout passed at ${width}px`);
  }
} finally { await browser.close(); }
