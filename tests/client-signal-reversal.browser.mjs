// All API calls are mocked. No real signals, receipts, events or messages are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { assertClientSignalHistoryPreserved, buildClientReceiptReversal, buildClientSignalReversal, validateClientPaymentUpdate } from '../src/utils/clientPayment.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/client-signal-reversal'; await mkdir(output, { recursive: true });
const now = new Date('2026-10-14T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event' };
const fixture = (patch = {}) => ({ id: 42, name: 'Sinalizacao QA', clientId: 1, client, date: '2026-10-09',
  status: 'finalized', statusMode: 'manual', requiredRoles: '[]', assignments: [], workLocations: [], externalCosts: '[]',
  totalRevenue: 252, totalCost: 100, taxAmount: 47.12, vatRateSnapshot: 23,
  billingStatus: 'partial70', signaledAmount: 175.5, paidAmount: 175.5, signaledAt: '2026-10-09',
  remainingPaymentDate: '2026-10-14', billingPaymentDate: null, updatedAt: now.toISOString(), ...patch });

async function setup(width, patch = {}, invoices = []) {
  const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
  await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa',
    user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'reversal-qa' })), now.getTime());
  const page = await context.newPage(); await page.clock.install({ time: now });
  page.on('pageerror', (error) => errors.push(error.message));
  const stored = fixture(patch), writes = [];
  let failNext = false, revision = 0;
  await page.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    if (request.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/services' ? [stored]
      : url.pathname === '/api/clients' ? [client] : [] });
    writes.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { message: 'Falha QA controlada' } }); }
    try {
      let patch;
      if (request.method() === 'POST') {
        assert.equal(request.postDataJSON().updatedAt, stored.updatedAt);
        if (url.pathname === '/api/services/42/client-payment/reverse-receipts') {
          patch = buildClientReceiptReversal(stored, invoices, request.postDataJSON());
          await new Promise((done) => setTimeout(done, 150));
        } else {
          assert.equal(url.pathname, '/api/services/42/client-payment/reverse-signal');
          patch = buildClientSignalReversal(stored, invoices);
        }
      } else {
        assert.equal(request.method(), 'PUT'); assert.equal(url.pathname, '/api/services/42');
        assertClientSignalHistoryPreserved(request.postDataJSON(), stored, invoices);
        patch = validateClientPaymentUpdate(request.postDataJSON(), stored);
      }
      Object.assign(stored, patch, { updatedAt: new Date(now.getTime() + ++revision * 1000).toISOString() });
      return route.fulfill({ json: stored });
    } catch (error) { return route.fulfill({ status: error.statusCode || 500, json: { message: error.message } }); }
  });
  await page.goto(`${base}/services/42?tab=costs`);
  const card = page.locator('.service-detail-payment-card'); await card.waitFor();
  return { context, page, card, stored, writes, fail: () => { failNext = true; } };
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const f = await setup(width), { page, card } = f;
    const original = structuredClone(f.stored);
    await card.getByLabel('Valor sinalizado', { exact: true }).fill('157,50');
    await card.getByLabel('Data da sinalização').fill('2026-10-10');
    await card.getByLabel('Data prevista do restante pagamento').fill('2026-10-20');
    assert.match(await card.getByLabel('Valor em falta', { exact: true }).inputValue(), /94,50/);
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await page.waitForFunction(() => document.querySelector('.service-detail-payment-actions button.command-button')?.textContent.includes('Guardar pagamento'));
    assert.equal(f.stored.signaledAmount, 157.5); assert.equal(f.stored.paidAmount, 157.5);
    assert.equal(f.stored.signaledAt, '2026-10-10'); assert.equal(f.stored.remainingPaymentDate, '2026-10-20');
    const reverse = card.getByRole('button', { name: 'Reverter sinalização' });
    page.once('dialog', (dialog) => { assert.match(dialog.message(), /reverter esta sinalização/); return dialog.dismiss(); });
    await reverse.click(); assert.equal(f.writes.length, 1, 'Cancel does not send a reversal');
    f.fail(); page.once('dialog', (dialog) => dialog.accept()); await reverse.click();
    await card.getByText('Falha QA controlada', { exact: true }).waitFor();
    assert.equal(f.stored.paidAmount, 157.5);
    page.once('dialog', (dialog) => dialog.accept()); await reverse.click();
    await page.waitForFunction(() => document.querySelector('.service-detail-payment-grid select')?.value === 'pending');
    assert.equal(f.stored.signaledAmount, 0); assert.equal(f.stored.paidAmount, 0); assert.equal(f.stored.signaledAt, null);
    assert.match(await card.getByLabel('Valor em falta', { exact: true }).inputValue(), /252,00/);
    assert.equal(await reverse.count(), 0);
    for (const field of ['totalRevenue', 'totalCost', 'taxAmount', 'vatRateSnapshot', 'status', 'requiredRoles', 'assignments', 'externalCosts']) {
      assert.deepEqual(f.stored[field], original[field]);
    }
    assert.equal(await card.locator('.client-payment-reference').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await card.locator('button').evaluateAll((buttons) => buttons.some((button) => button.scrollWidth > button.clientWidth + 1)), false);
    await card.screenshot({ path: `${output}/reversed-${width}.png` });
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    await page.locator('.finance-client-summary-row').filter({ hasText: 'Cliente QA' }).click();
    assert.equal(await page.locator('.finance-client-event-row .finance-client-status-select').inputValue(), 'pending');
    assert.equal(await page.locator('.client-payment-reference').count(), 0);
    await f.context.close();
    console.log(`Costs edit/date correction, cancel, failed write, reversal and Finance consistency passed at ${width}px`);
  }
  for (const patch of [{ billingStatus: 'paid', paidAmount: 252, signaledAmount: 157.5 }, { paidAmount: 200 }]) {
    const f = await setup(390, patch);
    assert.equal(await f.card.getByRole('button', { name: 'Reverter sinalização' }).isDisabled(), true);
    await f.card.getByText(/a reversão foi bloqueada/).waitFor();
    assert.equal(f.writes.length, 0); await f.context.close();
  }
  const invoice = await setup(390, {}, [{ status: 'paid', issueDate: '2026-10-14' }]);
  const before = structuredClone(invoice.stored);
  invoice.page.once('dialog', (dialog) => dialog.accept());
  await invoice.card.getByRole('button', { name: 'Reverter sinalização' }).click();
  await invoice.card.locator('.form-error').filter({ hasText: /pagamentos posteriores/ }).waitFor();
  assert.deepEqual(invoice.stored, before); await invoice.context.close();
  for (const width of [320, 390, 768, 1440]) {
    const f = await setup(width, { name: 'Particular - Rita Antunes QA', billingStatus: 'pending', totalRevenue: 1252.14,
      signaledAmount: 816.23, paidAmount: 1166.04, signaledAt: null, billingPaymentDate: '2026-07-27' });
    const { page, card } = f, original = structuredClone(f.stored);
    assert.match(await card.locator('.event-payment-balance > div').filter({ hasText: 'Total recebido registado' }).textContent(), /1166,04/);
    const reverseAll = card.getByRole('button', { name: 'Reverter recebimentos', exact: true });
    const confirmation = (dialog) => {
      assert.match(dialog.message(), /Reverter todos os recebimentos/);
      assert.match(dialog.message(), /816,23/); assert.match(dialog.message(), /349,81/);
      assert.match(dialog.message(), /1166,04/); assert.match(dialog.message(), /1252,14/);
    };
    page.once('dialog', (dialog) => { confirmation(dialog); return dialog.dismiss(); });
    await reverseAll.click(); assert.equal(f.writes.length, 0); assert.deepEqual(f.stored, original);
    f.fail(); page.once('dialog', (dialog) => { confirmation(dialog); return dialog.accept(); });
    await reverseAll.click(); await card.getByText('Falha QA controlada', { exact: true }).waitFor();
    assert.deepEqual(f.stored, original);
    page.on('dialog', (dialog) => { confirmation(dialog); return dialog.accept(); });
    const before = f.writes.length;
    await reverseAll.evaluate((button) => { button.click(); button.click(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.event-payment-balance > div')]
      .some((row) => row.textContent.includes('Total recebido registado') && row.querySelector('dd')?.textContent.includes('0,00')));
    await card.getByRole('button', { name: 'Reverter recebimentos', exact: true }).waitFor({ state: 'detached' });
    assert.equal(f.writes.length, before + 1, 'double click sends one explicit correction');
    assert.equal(f.stored.paidAmount, 0); assert.equal(f.stored.signaledAmount, 0);
    assert.equal(f.stored.signaledAt, null); assert.equal(f.stored.billingPaymentDate, null);
    assert.equal(f.stored.billingStatus, 'pending');
    assert.match(await card.getByLabel('Valor em falta', { exact: true }).inputValue(), /1252,14/);
    assert.equal(f.stored.totalRevenue, original.totalRevenue); assert.equal(f.stored.taxAmount, original.taxAmount);
    assert.equal(f.stored.totalCost, original.totalCost); assert.equal(f.stored.status, original.status);
    assert.equal(f.stored.remainingPaymentDate, original.remainingPaymentDate);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await card.screenshot({ path: `${output}/receipts-corrected-${width}.png` });
    await f.context.close();
    console.log(`Explicit receipt reversal: amount confirmation, cancel, failure, double click and preserved service at ${width}px.`);
  }
  const locked = await setup(390, { paidAmount: 200 }, [{ status: 'issued', issueDate: '2026-10-14' }]);
  locked.page.once('dialog', (dialog) => dialog.accept());
  await locked.card.getByRole('button', { name: 'Reverter recebimentos', exact: true }).click();
  await locked.card.locator('.form-error').filter({ hasText: /faturação emitida/ }).waitFor();
  assert.equal(locked.stored.paidAmount, 200); await locked.context.close();
  assert.deepEqual(errors, []);
  console.log('Settled/later payments and paid invoice guards preserve history; no real data touched.');
} finally { await browser.close(); }
