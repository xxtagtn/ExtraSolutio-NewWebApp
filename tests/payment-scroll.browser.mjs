// Every API request is intercepted; no real payments or events are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildAdditionalClientPayment, validateClientPaymentUpdate } from '../src/utils/clientPayment.js';
import { clientPaymentRecordPatch } from '../server/services/clientPaymentRecord.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-10-21T12:00:00Z'), errors = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    for (const scenario of ['signal', 'remaining', 'integral', 'edit', 'additional']) {
      const context = await browser.newContext({ viewport: { width, height: 650 }, timezoneId: 'Europe/Lisbon' });
      await context.addInitScript((time) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa-only',
        user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: time, sessionId: 'payment-scroll-qa' })), now.getTime());
      const page = await context.newPage(); await page.clock.install({ time: now });
      page.on('pageerror', (error) => errors.push(error.message));
      const stored = { id: 42, name: 'Scroll pagamento QA', date: '2026-10-20', status: 'finalized', statusMode: 'manual',
        totalRevenue: 252, totalCost: 100, taxAmount: 0, staffVatRateSnapshot: 0, vatRateSnapshot: 0,
        clientId: 1, client: { id: 1, name: 'Cliente QA' }, workLocations: [], assignments: [], requiredRoles: '[]', externalCosts: '[]',
        billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100, signaledAt: '2026-10-20',
        remainingPaymentDate: '2026-10-22', billingPaymentDate: null, updatedAt: now.toISOString() };
      if (scenario === 'signal' || scenario === 'integral') Object.assign(stored, {
        billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, signaledAt: null,
      });
      if (scenario === 'additional') {
        const paid = { billingStatus: 'paid', paidAmount: 252, billingPaymentDate: '2026-10-20' };
        Object.assign(stored, clientPaymentRecordPatch(stored, paid), paid, { totalRevenue: 300 });
      }
      let writes = 0;
      await page.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
        if (request.method() === 'GET') {
          if (writes && url.pathname === '/api/services') await new Promise((done) => setTimeout(done, 150));
          return route.fulfill({ json: url.pathname === '/api/services' ? [stored]
            : url.pathname === '/api/services/42' ? stored : url.pathname === '/api/clients' ? [stored.client] : [] });
        }
        const input = request.postDataJSON();
        assert.equal(url.pathname, scenario === 'additional' ? '/api/services/42/client-payment/receive-additional' : '/api/services/42');
        const patch = scenario === 'additional' ? buildAdditionalClientPayment(stored, input) : validateClientPaymentUpdate(input, stored);
        Object.assign(patch, clientPaymentRecordPatch(stored, patch, scenario === 'additional' ? { type: 'adjustment' } : {}));
        Object.assign(stored, patch); writes += 1;
        return route.fulfill({ json: stored });
      });
      await page.goto(`${base}/services/42?tab=costs`);
      const card = page.locator('.service-detail-payment-card'); await card.waitFor();
      await card.locator('.payment-overview-receipts > summary').click();
      if (scenario === 'edit') await card.getByRole('button', { name: 'Editar pagamento', exact: true }).click();
      else await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      if (scenario === 'signal') {
        await dialog.getByLabel('Valor sinalizado', { exact: true }).fill('100');
        await dialog.getByLabel('Data da sinalização').fill('2026-10-21');
      } else if (scenario === 'integral') {
        await dialog.getByLabel('Tipo de recebimento').selectOption('paid');
        await dialog.getByLabel('Data efetiva do recebimento').fill('2026-10-21');
      } else if (scenario === 'remaining') await dialog.getByLabel('Data efetiva do recebimento').fill('2026-10-21');
      else if (scenario === 'edit') await dialog.getByLabel('Data prevista do restante pagamento').fill('2026-10-23');
      else await dialog.getByLabel('Data do novo recebimento').fill('2026-10-21');
      const before = await page.evaluate(() => {
        window.__paymentCard = document.querySelector('.service-detail-payment-card');
        window.__paymentScrolls = [scrollY];
        addEventListener('scroll', () => window.__paymentScrolls.push(scrollY));
        return scrollY;
      });
      assert.ok(before > 50, `Fixture must start scrolled, got ${before} at ${width}px (${scenario})`);
      await dialog.getByRole('button', { name: scenario === 'additional' ? 'Registar recebimento' : 'Guardar pagamento', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await card.waitFor();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const after = await page.evaluate(() => ({ y: scrollY, minimum: Math.min(...window.__paymentScrolls),
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        sameCard: window.__paymentCard === document.querySelector('.service-detail-payment-card'),
        open: document.querySelector('.payment-overview-receipts').open }));
      assert.equal(writes, 1);
      assert.equal(after.sameCard, true, 'Saving must not unmount the payment card');
      assert.equal(after.open, true, 'Saving preserves the open receipt history');
      // A settled balance removes its action/summary; the browser may clamp to the new page end.
      const expected = Math.min(before, after.maximum);
      assert.ok(Math.abs(after.y - expected) <= 2, `Scroll moved ${before} -> ${after.y} (maximum ${after.maximum}) at ${width}px (${scenario})`);
      assert.ok(after.minimum >= expected - 2, `Page briefly jumped to ${after.minimum} from ${before}`);
      await context.close();
      console.log(`Scroll and expanded history preserved for ${scenario} at ${width}px (${before}px).`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
