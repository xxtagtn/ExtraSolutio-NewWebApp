// API writes are intercepted. Real persistence is covered by eventCostRegression.test.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { assignmentDerivedHours } from '../src/utils/assignmentDerivedHours.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/dynamic-event-finance';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
const now = new Date('2026-10-15T12:00:00Z');
const errors = [];

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'dynamic-finance-qa' })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    const client = { id: 1, name: 'FIC Restaurante QA', billingMethod: 'per_event', paymentTerm: 'days_15' };
    const person = { id: 1, name: 'Colaborador QA', hourlyRate: 8, includeVat: false };
    const assignment = { id: 100, eventId: 42, collaboratorId: 1, collaborator: person, role: 'Emp.Mesa', hourlyRate: 8,
      assignmentDate: '2026-10-16', status: 'confirmed', plannedCheckIn: '18:00', plannedCheckOut: '00:00',
      checkIn: '18:00', checkOut: '00:00', validationStatus: 'pending', paymentStatus: 'unpaid' };
    const stored = { id: 42, name: 'FIC Restaurante - FIXOS', date: '2026-10-16', status: 'to_validate_staff', statusMode: 'manual',
      startTime: '18:00', endTime: '00:00', clientId: 1, client, assignments: [assignment], billingStatus: 'pending',
      requiredRoles: '[{"role":"Emp.Mesa","qty":1,"agreedRate":10}]', vatRateSnapshot: 23, workLocations: [],
      externalCosts: JSON.stringify(normalizeExternalCosts([{ id: 'partner', type: 'Aluguer', costAmount: 450, marginPercent: 10, vatType: 'standard_23' }])) };
    const recalculate = () => Object.assign(stored, calculateEventTotals(stored, stored.assignments)); recalculate();
    const writes = []; let holdNext = false, held;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      if (request.method() !== 'GET') {
        const payload = request.postDataJSON(); writes.push({ path, payload });
        assert.equal(path, '/assignments/100'); assert.equal(request.method(), 'PUT');
        Object.assign(assignment, payload); Object.assign(assignment, assignmentDerivedHours(assignment, stored)); recalculate();
        return route.fulfill({ json: assignment });
      }
      if (path === '/services') {
        if (holdNext) { holdNext = false; held = { route, snapshot: structuredClone(stored) }; return; }
        return route.fulfill({ json: [stored] });
      }
      return route.fulfill({ json: path === '/clients' ? [client] : path.startsWith('/collaborators') ? [person] : [] });
    });
    await page.goto(`${base}/time-validation?eventId=42`);
    const row = page.locator('.validation-table .validation-row').first(); await row.waitFor();
    await row.getByRole('textbox', { name: 'Saída Staff', exact: true }).fill('0200');
    await row.getByRole('textbox', { name: 'Notas de validação' }).click();
    const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/services') && response.request().method() === 'GET');
    await row.getByRole('button', { name: 'Guardar validação', exact: true }).click();
    await savedResponse;
    assert.equal(writes.length, 1); assert.equal(writes[0].payload.clientBillableHours, 8);
    assert.equal(stored.billableHours, 8); assert.equal(stored.totalRevenue, 707.25);
    const card = page.locator('.service-detail-cost-summary');
    const metric = (label) => card.locator(`[data-finance-metric="${label}"]`);
    const expectMetric = async (label, value) => {
      await metric(label).waitFor(); await page.waitForFunction(({ label, value }) => [...document.querySelectorAll('[data-finance-metric]')]
        .some((node) => node.dataset.financeMetric === label && node.textContent === value), { label, value });
    };
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
    await expectMetric('Horas Faturáveis', '8:00h'); await expectMetric('Receita com IVA', money(707.25));
    // Simulate a correction in another tab; returning focus must update the visible card.
    Object.assign(assignment, { clientCheckIn: '18:00', clientCheckOut: '01:30' }); recalculate();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expectMetric('Horas Faturáveis', '7:30h'); await expectMetric('Receita com IVA', money(701.1));
    // A slow, older response must not overwrite the newer financial result or cache.
    holdNext = true;
    const pendingRead = page.waitForRequest((request) => request.url().endsWith('/api/services'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pendingRead;
    while (!held) await new Promise((done) => setTimeout(done, 10));
    Object.assign(assignment, { clientCheckOut: '03:00' }); recalculate();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expectMetric('Horas Faturáveis', '9:00h'); await expectMetric('Receita com IVA', money(719.55));
    await held.route.fulfill({ json: [held.snapshot] });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await metric('Horas Faturáveis').textContent(), '9:00h');
    const cached = await page.evaluate(async () => (await import('/src/utils/apiCache.js')).readApiCache('/services'));
    assert.equal(cached[0].totalRevenue, 719.55);
    await card.screenshot({ path: `${output}/updated-costs-${width}.png` });
    stored.status = 'finalized';
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    await page.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    const eventRow = page.locator('.finance-client-event-row').filter({ hasText: stored.name }); await eventRow.waitFor();
    assert.ok((await eventRow.textContent()).includes(money(719.55)));
    Object.assign(assignment, { clientCheckOut: '04:00' }); recalculate();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction((expected) => [...document.querySelectorAll('.finance-client-event-row')].some((node) => node.textContent.includes(expected)), money(731.85));
    assert.equal(writes.length, 1, 'background refreshes never write payment or validation data');
    stored.status = 'to_validate_client';
    Object.assign(assignment, { clientCheckIn: '18:00', clientCheckOut: '00:00', validatedCheckIn: '18:00',
      validatedCheckOut: '00:00', validationStatus: 'validated', clientRealHours: 6, clientBillableHours: 6 }); recalculate();
    await page.goto(`${base}/time-validation?eventId=42`);
    const clientExit = page.getByRole('textbox', { name: 'Saída Cliente', exact: true }); await clientExit.waitFor();
    await clientExit.fill('0130');
    const correctionResponse = page.waitForResponse((response) => response.url().endsWith('/api/assignments/100') && response.request().method() === 'PUT');
    await page.getByRole('textbox', { name: 'Notas de validação' }).click();
    await page.getByRole('button', { name: 'Guardar validação', exact: true }).click();
    await correctionResponse;
    assert.equal(writes.at(-1).payload.validatedCheckOut, null);
    assert.equal(writes.at(-1).payload.clientRealHours, 7.5);
    assert.equal(writes.at(-1).payload.clientBillableHours, 7.5);
    assert.equal(stored.totalRevenue, 701.1);
    await context.close(); console.log(`Dynamic validation -> Costs -> Finance, focus refresh and stale-response protection passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
