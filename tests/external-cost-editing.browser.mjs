// All API traffic is intercepted. No real events, payments, staff or messages are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { applyExternalCostChange } from '../src/utils/externalCostEditing.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';
import { calculateEventTotals } from '../server/utils/eventTotals.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/external-cost-editing';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-10-15T12:00:00Z');
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
const errors = [];
const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event' };
const fixture = () => ({ id: 42, name: 'Evento parceiros QA', date: '2026-10-20', status: 'in_progress', statusMode: 'manual',
  clientId: 1, client, assignments: [], workLocations: [], requiredRoles: '[]', vatRateSnapshot: 23,
  externalCosts: JSON.stringify(normalizeExternalCosts([{ id: 'partner-a', type: 'Catering', supplier: 'Parceiro A',
    description: 'Servico principal', costAmount: 500, marginPercent: 20, vatType: 'standard_23' }])),
  totalCost: 500, totalRevenue: 738, taxAmount: 138, updatedAt: now.toISOString(),
  billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100, signaledAt: '2026-10-10',
  remainingPaymentDate: '2026-10-25', billingPaymentDate: null, notes: 'Nao alterar pagamentos' });

async function noOverflow(page, locator) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Page horizontal overflow');
  assert.equal(await locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false, 'Panel horizontal overflow');
  const bad = await locator.locator('button, input, select').evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1);
  }).map((element) => element.textContent || element.getAttribute('aria-label') || element.tagName));
  assert.deepEqual(bad, [], 'Clipped controls');
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'qa', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'external-cost-qa',
    })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    let stored = fixture(), version = 0, failNext = 0, delayed = false;
    const originalPayment = Object.fromEntries(['billingStatus', 'paidAmount', 'signaledAmount', 'signaledAt', 'remainingPaymentDate', 'billingPaymentDate', 'notes']
      .map((field) => [field, stored[field]]));
    const writes = [];
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/services' ? [stored]
        : url.pathname === '/api/clients' ? [client] : [] });
      writes.push(url.pathname);
      assert.match(url.pathname, /^\/api\/services\/42\/external-costs(?:\/[^/]+)?$/);
      if (failNext) { const status = failNext; failNext = 0; return route.fulfill({ status, json: { message: 'Falha QA: custo nao guardado' } }); }
      const payload = request.postDataJSON();
      if (payload.updatedAt !== stored.updatedAt) return route.fulfill({ status: 409, json: { message: 'O evento foi alterado. Atualiza a pagina.' } });
      if (delayed) await new Promise((resolve) => setTimeout(resolve, 250));
      const costId = request.method() === 'PUT' ? decodeURIComponent(url.pathname.split('/').at(-1)) : null;
      const change = applyExternalCostChange(stored.externalCosts, payload.cost, { costId });
      stored = { ...stored, externalCosts: JSON.stringify(change.rows), updatedAt: new Date(now.getTime() + ++version * 1000).toISOString() };
      Object.assign(stored, calculateEventTotals(stored, stored.assignments));
      return route.fulfill({ json: stored });
    });
    const card = page.locator('.service-detail-external-card');
    const dialog = page.getByRole('dialog');
    const save = () => dialog.getByRole('button', { name: 'Guardar custo', exact: true }).click();
    const open = async () => { await page.goto(`${base}/services/42?tab=costs`); await card.waitFor(); };
    const fill = async (supplier, amount, vatType = 'standard_23') => {
      await dialog.getByLabel(/^Tipo/).selectOption('Catering');
      await dialog.getByLabel('Fornecedor', { exact: true }).fill(supplier);
      await dialog.getByLabel('Custo parceiro', { exact: true }).fill(String(amount));
      await dialog.getByLabel('Margem %', { exact: true }).fill('20');
      await dialog.getByLabel(/^IVA/).selectOption(vatType);
    };
    await open();
    await card.getByRole('button', { name: 'Editar custo externo Parceiro A' }).click();
    await dialog.getByLabel('Custo parceiro', { exact: true }).fill('600');
    await dialog.getByLabel('Margem %', { exact: true }).fill('25');
    assert.match(await dialog.locator('.budget-external-result').textContent(), /922,50/);
    await noOverflow(page, dialog);
    await dialog.screenshot({ path: `${output}/editor-${width}.png` });
    await save(); await dialog.waitFor({ state: 'detached' });
    await card.getByText(money(922.5), { exact: true }).waitFor();
    assert.equal(stored.totalCost, 600); assert.equal(stored.totalRevenue, 922.5); assert.equal(stored.taxAmount, 172.5);
    assert.equal(JSON.parse(stored.externalCosts)[0].id, 'partner-a');
    await open();
    await card.getByRole('button', { name: 'Editar custo externo Parceiro A' }).click();
    assert.equal(await dialog.getByLabel('Custo parceiro', { exact: true }).inputValue(), '600');
    assert.equal(await dialog.getByLabel('Margem %', { exact: true }).inputValue(), '25');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    const first = JSON.parse(stored.externalCosts)[0];
    await card.getByRole('button', { name: 'Adicionar custo externo/parceiro', exact: true }).click();
    await save(); await dialog.getByRole('alert').waitFor();
    assert.equal(writes.length, 1, 'Invalid form never sends a request');
    await fill('Parceiro B', 150);
    delayed = true;
    await dialog.getByRole('button', { name: 'Guardar custo', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await dialog.waitFor({ state: 'detached' }); delayed = false;
    await card.locator('.service-detail-external-item').nth(1).waitFor();
    assert.equal(writes.length, 2, 'Double submit sends exactly one add request');
    assert.deepEqual(JSON.parse(stored.externalCosts)[0], first);
    assert.equal(stored.totalRevenue, 1143.9); assert.equal(stored.totalCost, 750);
    assert.equal(stored.assignments.length, 0);
    await open(); assert.equal(await card.locator('.service-detail-external-item').count(), 2);
    await card.getByRole('button', { name: 'Adicionar custo externo/parceiro', exact: true }).click();
    await fill('Parceiro C', 100, 'exempt');
    await save(); await dialog.waitFor({ state: 'detached' });
    await card.locator('.service-detail-external-item').nth(2).waitFor();
    assert.equal(stored.totalRevenue, 1263.9);
    await card.getByRole('button', { name: 'Editar custo externo Parceiro C' }).click();
    await dialog.getByLabel(/^IVA/).selectOption('catering');
    await save(); await dialog.waitFor({ state: 'detached' });
    await card.getByText(money(137.4), { exact: true }).waitFor();
    assert.equal(stored.totalRevenue, 1281.3); assert.equal(stored.totalCost, 850);
    assert.deepEqual(JSON.parse(stored.externalCosts)[0], first);
    for (const status of [500, 409]) {
      const before = structuredClone(stored);
      await card.getByRole('button', { name: 'Editar custo externo Parceiro B' }).click();
      await dialog.getByLabel('Custo parceiro', { exact: true }).fill('333');
      failNext = status; await save(); await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByLabel('Custo parceiro', { exact: true }).inputValue(), '333');
      assert.deepEqual(stored, before);
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    }
    await card.getByRole('button', { name: 'Editar custo externo Parceiro B' }).click();
    await dialog.getByLabel('Custo parceiro', { exact: true }).fill('444');
    stored.updatedAt = new Date(now.getTime() + ++version * 1000).toISOString();
    const staleBefore = structuredClone(stored);
    await save(); await dialog.getByRole('alert').waitFor(); assert.deepEqual(stored, staleBefore);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    for (const [field, value] of Object.entries(originalPayment)) assert.deepEqual(stored[field], value, field);
    await open(); await noOverflow(page, card);
    await card.screenshot({ path: `${output}/partners-${width}.png` });
    const summary = page.locator('.service-detail-payment-card');
    assert.equal(await summary.getByLabel('Valor total', { exact: true }).inputValue(), money(stored.totalRevenue));
    await context.close();
    console.log(`External cost edit/add/persistence, multiple VAT rates, double-submit, validation, failed/stale saves and unchanged receipts passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
