// Read-only fixtures: no real service edits, receipts, API writes or messages.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/client-payment-reference';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const now = new Date('2026-10-14T12:00:00Z');
const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event', prepaymentPercent: 50 };
const fixture = (patch = {}) => ({ id: 42, name: 'Referencia cliente QA', date: '2026-10-09', status: 'finalized', statusMode: 'manual',
  requiredRoles: '[]', assignments: [], workLocations: [], clientId: 1, client, externalCosts: '[]', totalRevenue: 252, totalCost: 100,
  billingStatus: 'partial70', signaledAmount: 157.5, paidAmount: 157.5, signaledAt: '2026-10-09',
  remainingPaymentDate: '2026-10-14', billingPaymentDate: null, billingAdjustment: 0, ...patch });
const currency = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
async function assertReference(locator, total, seventy, thirty) {
  if (!await locator.isVisible()) await locator.locator('..').locator(':scope > summary').click();
  await locator.waitFor();
  assert.deepEqual(await locator.locator('dd').allTextContents(), [currency(total), currency(seventy), currency(thirty)]);
  assert.equal(await locator.locator('input, select, button').count(), 0, 'References cannot change payment data');
  assert.equal(await locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'qa', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'reference-qa',
    })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    const stored = fixture(); const payment = structuredClone(stored); const writes = [];
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: {} }); }
      return route.fulfill({ json: url.pathname === '/api/services' ? [stored] : url.pathname === '/api/clients' ? [client] : [] });
    });
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    await page.locator('.finance-client-summary-row').filter({ hasText: 'Cliente QA' }).click();
    const row = page.locator('.finance-client-event-row').filter({ hasText: 'Referencia cliente QA' });
    assert.equal(await page.locator('.client-payment-reference').count(), 0, 'Finance must not show commercial references');
    await row.getByRole('button', { name: 'Ver resumo de Referencia cliente QA' }).click();
    const modal = page.getByRole('dialog', { name: 'Resumo do Evento/Serviço' });
    await modal.waitFor();
    assert.equal(await modal.locator('.client-payment-reference').count(), 0);
    // A newly queried service total updates both the row and its payment summary.
    stored.totalRevenue = 790;
    await page.reload();
    await page.locator('.finance-client-summary-row').filter({ hasText: 'Cliente QA' }).click();
    await row.waitFor();
    assert.equal(await page.locator('.client-payment-reference').count(), 0);
    await row.getByRole('button', { name: 'Ver resumo de Referencia cliente QA' }).click();
    await modal.waitFor();
    assert.equal(await modal.locator('.client-payment-reference').count(), 0);
    await page.goto(`${base}/services/42?tab=costs`);
    const card = page.locator('.service-detail-payment-card'); await card.waitFor();
    await assertReference(card.locator('.client-payment-reference'), 790, 553, 237);
    for (const [total, seventy, thirty] of [[100, 70, 30], [252, 176.4, 75.6], [1000, 700, 300]]) {
      stored.totalRevenue = total;
      await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
      await assertReference(card.locator('.client-payment-reference'), total, seventy, thirty);
    }
    for (const billingStatus of ['pending', 'partial70', 'invoiced', 'paid']) {
      stored.billingStatus = billingStatus;
      await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
      await assertReference(card.locator('.client-payment-reference'), 1000, 700, 300);
    }
    for (const field of ['signaledAmount', 'paidAmount', 'signaledAt', 'remainingPaymentDate', 'billingPaymentDate']) {
      assert.deepEqual(stored[field], payment[field], field);
    }
    assert.deepEqual(writes, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await card.screenshot({ path: `${output}/reference-${width}.png` });
    await context.close();
    console.log(`70/30 references only in event Costs, updated totals and all payment states passed at ${width}px; absent from Finance; no writes.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
