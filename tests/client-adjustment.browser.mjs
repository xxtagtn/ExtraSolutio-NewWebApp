// All API traffic is intercepted. These fixtures cannot change real events or receipts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { clientPaymentRecordPatch } from '../server/services/clientPaymentRecord.js';
import { buildAdditionalClientPayment, clientPaymentSummary } from '../src/utils/clientPayment.js';
import { readClientPaymentRecord } from '../src/utils/clientPaymentRecord.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/client-adjustment'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], now = new Date('2026-10-21T12:00:00Z');
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((time) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa-only',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: time, sessionId: 'adjustment-qa' })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    const original = { id: 42, name: 'Acerto IVA QA', date: '2026-10-20', status: 'finalized', statusMode: 'manual',
      clientId: 1, client: { id: 1, name: 'Cliente QA' }, workLocations: [], assignments: [], requiredRoles: '[]',
      billingStatus: 'partial70', signaledAmount: 200, signaledAt: '2026-10-16', paidAmount: 200,
      remainingPaymentDate: '2026-10-20', totalRevenue: 1392.36, totalCost: 944, taxAmount: 260.36,
      staffVatRateSnapshot: 23, vatRateSnapshot: 0, updatedAt: now.toISOString(),
      externalCosts: JSON.stringify(normalizeExternalCosts([
        { id: 'flowers', type: 'Outro', supplier: 'Flores QA', costAmount: 500, marginPercent: 10, vatType: 'standard_23' },
        { id: 'napkins', type: 'Material', costAmount: 300, marginPercent: 10, vatType: 'standard_23' },
      ])) };
    const settlement = { billingStatus: 'paid', paidAmount: 1392.36, billingPaymentDate: '2026-10-20' };
    const stored = { ...original, ...settlement, ...clientPaymentRecordPatch(original, settlement), totalRevenue: 1426.8, taxAmount: 266.8 };
    const initialRecord = readClientPaymentRecord(stored.clientPaymentRecord);
    let writes = 0;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/services' ? [stored]
        : url.pathname === '/api/services/42' ? stored : url.pathname === '/api/clients' ? [stored.client] : [] });
      assert.equal(url.pathname, '/api/services/42/client-payment/receive-additional'); assert.equal(request.method(), 'POST');
      const input = request.postDataJSON(); assert.equal(input.updatedAt, stored.updatedAt);
      const patch = buildAdditionalClientPayment(stored, input);
      Object.assign(patch, clientPaymentRecordPatch(stored, patch, { type: 'adjustment' }));
      Object.assign(stored, patch, { updatedAt: new Date(now.getTime() + 1000).toISOString() });
      writes += 1; await new Promise((done) => setTimeout(done, 100));
      return route.fulfill({ json: stored });
    });
    const card = page.locator('.service-detail-payment-card'), summary = card.locator('.service-detail-payment-summary');
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
    const baseRow = summary.locator('.client-adjustment-detail dl > div').filter({ hasText: 'Base a faturar' });
    assert.match(await baseRow.textContent(), /28,00/);
    assert.match(await summary.locator('.client-adjustment-detail dl > div').filter({ hasText: 'IVA (23%)' }).textContent(), /6,44/);
    assert.match(await summary.locator('strong').textContent(), /34,44/);
    assert.match(await card.locator('[data-payment-metric="outstanding"] dd').textContent(), /34,44/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await summary.evaluate((root) => [...root.querySelectorAll('dt,dd,strong')].some((node) => node.scrollWidth > node.clientWidth + 1)), false);
    await card.screenshot({ path: `${output}/outstanding-${width}.png` });
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Registar pagamento adicional', exact: true });
    await modal.waitFor(); await modal.getByText('Base a faturar', { exact: false }).waitFor();
    assert.match(await modal.getByLabel('Valor adicional recebido').inputValue(), /34,44/);
    await modal.getByLabel('Data do novo recebimento').fill('2026-10-21');
    await modal.getByRole('button', { name: 'Registar recebimento', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await modal.waitFor({ state: 'detached' }); assert.equal(writes, 1);
    assert.equal(clientPaymentSummary(stored).received, 1426.8); assert.equal(clientPaymentSummary(stored).outstanding, 0);
    await card.locator('.payment-overview-receipts > summary').click();
    await card.locator('.client-adjustment-history > summary').click();
    assert.match(await card.locator('.client-adjustment-history').textContent(), /28,00/);
    assert.match(await card.locator('.client-adjustment-history').textContent(), /6,44/);
    assert.match(await card.locator('.client-adjustment-history').textContent(), /34,44/);
    assert.deepEqual(readClientPaymentRecord(stored.clientPaymentRecord).entries.slice(0, 2), initialRecord.entries);
    await card.screenshot({ path: `${output}/history-${width}.png` });
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
    await card.locator('.payment-overview-receipts > summary').click();
    await card.locator('.client-adjustment-history > summary').click();
    assert.match(await card.locator('.client-adjustment-history').textContent(), /28,00/);
    // Legacy underpayment has no safe tax baseline; never invent a divided value.
    stored.clientPaymentRecord = JSON.stringify({ version: 1, expectedTotal: 1392.36, entries: initialRecord.entries });
    stored.paidAmount = 1392.36;
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor(); await summary.locator('.client-adjustment-unavailable').waitFor();
    assert.equal(await summary.locator('.client-adjustment-detail').count(), 0);
    assert.match(await summary.locator('strong').textContent(), /34,44/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (width === 390 || width === 1440) {
      const mixedOriginal = { ...original, totalRevenue: 300, taxAmount: 0, staffVatRateSnapshot: 0, externalCosts: '[]' };
      const mixedSettlement = { ...settlement, paidAmount: 300 };
      Object.assign(stored, mixedOriginal, mixedSettlement, clientPaymentRecordPatch(mixedOriginal, mixedSettlement), {
        totalRevenue: 587.5, taxAmount: 37.5,
        externalCosts: JSON.stringify(normalizeExternalCosts([
          { id: 'exempt', type: 'Outro', costAmount: 50, vatType: 'exempt' },
          { id: 'standard', type: 'Aluguer', costAmount: 100, vatType: 'standard_23' },
          { id: 'catering', type: 'Catering', costAmount: 100, vatType: 'catering' },
        ])),
      });
      await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
      await summary.locator('.client-adjustment-detail > details > summary').click();
      assert.match(await summary.locator('.client-adjustment-detail').textContent(), /250,00/);
      assert.match(await summary.locator('.client-adjustment-detail').textContent(), /37,50/);
      assert.match(await summary.locator('.client-adjustment-detail').textContent(), /13% \/ 23%/);
      await card.screenshot({ path: `${output}/mixed-${width}.png` });
      await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
      await modal.getByLabel('Valor adicional recebido').fill('50');
      await modal.getByLabel('Data do novo recebimento').fill('2026-10-21');
      await modal.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
      await modal.waitFor({ state: 'detached' }); assert.equal(writes, 2);
      assert.equal(clientPaymentSummary(stored).outstanding, 237.5);
      await summary.getByText('Base total do acerto', { exact: false }).waitFor();
      assert.match(await summary.locator('.client-adjustment-detail').textContent(), /250,00/);
      assert.match(await summary.locator('.client-adjustment-detail').textContent(), /Já recebido deste acerto50,00/);
      assert.match(await summary.locator('strong').textContent(), /237,50/);
      await card.getByRole('button', { name: 'Editar pagamento', exact: true }).click();
      await card.getByLabel('Valor sinalizado', { exact: true }).fill('201');
      assert.equal(await summary.locator('.client-adjustment-detail').count(), 1, 'Overview remains the recorded balance while editing');
      await card.getByLabel('Valor sinalizado', { exact: true }).fill('200');
      await summary.locator('.client-adjustment-detail').waitFor();
      await page.getByRole('dialog', { name: 'Editar pagamento', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await card.screenshot({ path: `${output}/partial-${width}.png` });
    }
    await context.close();
    console.log(`VAT adjustment, receipt, immutable history, reload and safe legacy display passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
