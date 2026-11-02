// Simulated read-only APIs; no real services, invoices, receipts or hours are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/vat-rounding';
await mkdir(output, { recursive: true });
const client = { id: 1, name: 'BLANK', billingMethod: 'per_event', paymentTerm: 'immediate', status: 'active' };
const source = { id: 41, name: 'Cocktail Saldanha - Blank (QA)', clientId: 1, client, date: '2026-10-28', endDate: '2026-10-30',
  status: 'finalized', isContinuous: true, staffVatRateSnapshot: 23, vatRateSnapshot: 23,
  requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 10.5 }], externalCosts: [], workLocations: [],
  paidAmount: 0, billingStatus: 'pending', clientPaymentRecord: { version: 1, entries: [], financeWorkflowVersion: 2 },
  assignments: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, collaboratorId: i % 3 + 1,
    collaborator: { id: i % 3 + 1, name: `Pessoa QA ${i % 3 + 1}` }, assignmentDate: `2026-10-${28 + Math.floor(i / 3)}`,
    role: 'Emp.Mesa', status: 'confirmed', validationStatus: 'validated', hourlyRate: 8,
    checkIn: '08:00', checkOut: '18:00', clientCheckIn: '08:00', clientCheckOut: i < 3 ? '19:00' : '18:00' })),
};
const event = { ...source, ...calculateEventTotals(source) }, original = structuredClone(event);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) {
    const writes = [], errors = [], now = new Date('2026-11-02T12:00:00Z');
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'vat-rounding-qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'vat-rounding-qa' })), now.getTime());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.fulfill({ json: url.pathname === '/api/services' ? [event] : url.pathname === '/api/services/41' ? event
        : url.pathname === '/api/clients' ? [client] : [] });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.goto(`${base}/services/41?tab=costs`);
    const card = page.locator('.service-detail-cost-summary'); await card.waitFor();
    assert.match(await card.locator('[data-finance-metric="Staff cobrado ao cliente"]').textContent(), /976,50/);
    assert.match(await card.locator('[data-finance-metric="Venda sem IVA"]').textContent(), /976,50/);
    assert.match(await card.locator('[data-finance-metric="IVA de venda"]').textContent(), /224,60/);
    assert.match((await card.locator('[data-finance-metric="Receita com IVA"]').textContent()).replace(/\s/g, ''), /1201,10/);
    assert.equal(await card.locator('[data-finance-metric="Valor por discriminar no total guardado"]').count(), 0);
    await card.screenshot({ path: `${output}/costs-${width}.png` });
    await page.goto(`${base}/finance?area=clients&eventId=41`);
    const workspace = page.locator('.finance-client-workspace'); await workspace.locator('.finance-client-summary-row').waitFor();
    const total = workspace.locator('.finance-client-summary-card--total .finance-client-amount');
    assert.match(await total.locator('strong').textContent(), /976,50/);
    assert.match((await total.locator('small').textContent()).replace(/\s/g, ''), /1201,10€c\/IVA/);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []); assert.deepEqual(event, original);
    await context.close(); console.log(`VAT rounding: Costs and Finance both show 976.50 + 224.60 = 1201.10 at ${width}px`);
  }
} finally { await browser.close(); }
