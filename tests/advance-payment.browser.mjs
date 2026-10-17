// Every API request is intercepted; no real events, payments or messages are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { normalizeEvent, normalizeAssignment } from '../server/routes/crud.js';
import { assignmentDerivedHours } from '../src/utils/assignmentDerivedHours.js';
import { buildAdditionalClientPayment, clientPaymentSummary, validateClientPaymentUpdate } from '../src/utils/clientPayment.js';
import { clientPaymentRecordPatch } from '../server/services/clientPaymentRecord.js';
import { readClientPaymentRecord } from '../src/utils/clientPaymentRecord.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/advance-payment'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-11-08T12:00:00Z'), errors = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'advance-payment-qa' })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => { errors.push(dialog.message()); return dialog.dismiss(); });
    const client = { id: 1, name: 'Globo de prata QA', billingMethod: 'per_event', roleRates: '[{"role":"Emp.Mesa","rate":30}]' };
    const stored = { id: 42, name: 'Corporate - Globo de prata QA', date: '2026-11-15', status: 'team_complete', statusMode: 'manual',
      startTime: '10:00', endTime: '16:00', clientId: 1, client, workLocations: [], vatRateSnapshot: 0,
      billingStatus: 'partial70', signaledAmount: 690.52, paidAmount: 690.52, signaledAt: '2026-10-15', remainingPaymentDate: '2026-11-08',
      billingPaymentDate: null, updatedAt: now.toISOString(), requiredRoles: '[{"role":"Emp.Mesa","qty":3,"agreedRate":30}]',
      assignments: [1, 2, 3].map((id) => ({ id, eventId: 42, collaboratorId: id, collaborator: { id, name: `Pessoa QA ${id}`, hourlyRate: 8 },
        role: 'Emp.Mesa', hourlyRate: 8, assignmentDate: '2026-11-15', status: 'confirmed', plannedCheckIn: '10:00', plannedCheckOut: '16:00',
        checkIn: '10:00', checkOut: '16:00', validationStatus: 'pending' })),
      externalCosts: JSON.stringify(normalizeExternalCosts([{ id: 'partner', type: 'Aluguer', supplier: 'Parceiro QA', costAmount: 446.46, vatType: 'exempt' }])) };
    const recalculate = () => Object.assign(stored, calculateEventTotals(stored, stored.assignments)); recalculate();
    let version = 0, additionalWrites = 0;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(4);
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() === 'GET') return route.fulfill({ json: path === '/services' ? [stored] : path === '/services/42' ? stored
        : path === '/clients' ? [client] : path.startsWith('/collaborators') ? stored.assignments.map((row) => row.collaborator) : [] });
      const input = request.postDataJSON();
      try {
        if (path === '/services/42') {
          const data = normalizeEvent(validateClientPaymentUpdate(input, stored) || input);
          Object.assign(data, clientPaymentRecordPatch(stored, data)); Object.assign(stored, data);
        } else if (/^\/assignments\/\d+$/.test(path)) {
          const row = stored.assignments.find((row) => row.id === Number(path.split('/').at(-1)));
          Object.assign(row, normalizeAssignment(input)); Object.assign(row, assignmentDerivedHours(row, stored));
          recalculate();
        } else if (path === '/services/42/client-payment/receive-additional') {
          assert.equal(input.updatedAt, stored.updatedAt);
          const data = buildAdditionalClientPayment(stored, input);
          Object.assign(data, clientPaymentRecordPatch(stored, data, { type: 'adjustment' })); Object.assign(stored, data);
          additionalWrites += 1; await new Promise((done) => setTimeout(done, 150));
        } else throw new Error(`Unexpected API write ${request.method()} ${path}`);
        stored.updatedAt = new Date(now.getTime() + ++version * 1000).toISOString();
        return route.fulfill({ json: path.startsWith('/assignments/') ? stored.assignments.find((row) => row.id === Number(path.split('/').at(-1))) : stored });
      } catch (error) { return route.fulfill({ status: error.statusCode || 500, json: { message: error.message } }); }
    });
    const card = page.locator('.service-detail-payment-card');
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
    assert.match(await card.locator('[data-payment-metric="outstanding"] dd').textContent(), /295,94/);
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    await card.getByLabel('Data efetiva do recebimento').fill('2026-11-08');
    await card.getByRole('button', { name: 'Guardar pagamento', exact: true }).click();
    await page.getByRole('dialog', { name: 'Registar recebimento', exact: true }).waitFor({ state: 'detached' });
    assert.equal(stored.paidAmount, 986.46); assert.equal(stored.status, 'team_complete');
    await card.locator('.payment-overview-heading-actions').getByText('Previsto totalmente recebido', { exact: true }).waitFor();
    await page.locator('.payment-reminder-toast').waitFor({ state: 'detached' });
    assert.match(await card.locator('[data-payment-metric="outstanding"] dd').textContent(), /0,00/);
    await card.screenshot({ path: `${output}/forecast-received-${width}.png` });
    const history = readClientPaymentRecord(stored.clientPaymentRecord);
    await page.goto(`${base}/time-validation?eventId=42`);
    const rows = page.locator('.validation-table .validation-row'); await rows.first().waitFor();
    await rows.nth(0).getByRole('textbox', { name: 'Entrada Staff', exact: true }).fill('0930');
    await rows.nth(0).getByRole('textbox', { name: 'Notas de validação' }).click();
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/services') && response.request().method() === 'GET');
    await rows.nth(0).getByRole('button', { name: 'Guardar validação', exact: true }).click(); await saved;
    await rows.nth(1).getByRole('textbox', { name: 'Saída Staff', exact: true }).fill('1630');
    await rows.nth(1).getByRole('textbox', { name: 'Notas de validação' }).click();
    const savedSecond = page.waitForResponse((response) => response.url().endsWith('/api/services') && response.request().method() === 'GET');
    await rows.nth(1).getByRole('button', { name: 'Guardar validação', exact: true }).click(); await savedSecond;
    assert.equal(stored.totalRevenue, 1016.46); assert.equal(stored.paidAmount, 986.46);
    assert.deepEqual(readClientPaymentRecord(stored.clientPaymentRecord), history);
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor();
    assert.match(await card.locator('[data-payment-metric="outstanding"] dd').textContent(), /30,00/);
    await card.getByText('Valor adicional em falta', { exact: true }).waitFor();
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Registar pagamento adicional', exact: true }); await modal.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await modal.screenshot({ path: `${output}/additional-dialog-${width}.png` });
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click(); assert.equal(additionalWrites, 0);
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    await modal.getByLabel('Data do novo recebimento').fill('2026-11-16');
    await modal.getByRole('button', { name: 'Registar recebimento', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await modal.waitFor({ state: 'detached' }); assert.equal(additionalWrites, 1);
    assert.equal(stored.paidAmount, 1016.46); assert.equal(clientPaymentSummary(stored).outstanding, 0);
    await card.locator('.payment-overview-receipts > summary').click();
    assert.equal(await card.locator('.event-payment-history li').count(), 3);
    await card.locator('.event-payment-history li').filter({ hasText: 'Acerto final' }).waitFor();
    assert.deepEqual(readClientPaymentRecord(stored.clientPaymentRecord).entries.slice(0, 2), history.entries);
    await card.screenshot({ path: `${output}/final-adjustment-${width}.png` });
    stored.totalRevenue = 950;
    await page.goto(`${base}/services/42?tab=costs`); await card.waitFor(); await card.getByText('Recebido em excesso', { exact: true }).first().waitFor();
    assert.match(await card.locator('.payment-overview-excess').textContent(), /66,46/);
    assert.equal(stored.paidAmount, 1016.46);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await context.close();
    console.log(`Advance payment -> Staff validation -> additional balance -> append receipt -> excess, preserved history and mobile layout passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
