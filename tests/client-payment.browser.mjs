// All API requests are mocked. No real receipts, event changes or messages are sent.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { validateClientPaymentUpdate, clientPaymentSummary } from '../src/utils/clientPayment.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/client-payment';
await mkdir(output, { recursive: true });
const now = new Date('2026-10-14T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const fixture = (patch = {}) => ({ id: 42, name: 'Pagamento cliente QA', date: '2026-10-09',
  status: 'finalized', statusMode: 'manual', billingStatus: 'partial70', requiredRoles: '[]', assignments: [],
  externalCosts: '[]', workLocations: [], clientId: 1, client: { id: 1, name: 'Cliente QA' },
  totalRevenue: 252, totalCost: 100, taxAmount: 47.12, vatRateSnapshot: 23,
  signaledAmount: 157.5, paidAmount: 157.5, signaledAt: '2026-10-09', remainingPaymentDate: '2026-10-14', billingPaymentDate: null, ...patch });

async function setup(width, patch = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
  await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'client-payment-qa',
  })), now.getTime());
  const page = await context.newPage(); await page.clock.install({ time: now });
  page.on('pageerror', (error) => errors.push(error.message));
  const stored = fixture(patch), writes = [];
  await page.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    if (request.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/services' ? [stored]
      : url.pathname === '/api/clients' ? [stored.client] : [] });
    assert.equal(request.method(), 'PUT'); assert.equal(url.pathname, '/api/services/42');
    const body = request.postDataJSON();
    const canonical = validateClientPaymentUpdate(body, stored);
    Object.assign(stored, canonical || body); writes.push(body);
    return route.fulfill({ json: stored });
  });
  await page.goto(`${base}/services/42?tab=costs`);
  const card = page.locator('.service-detail-payment-card'); await card.waitFor();
  return { page, card, context, stored, writes };
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const f = await setup(width), { page, card } = f;
    assert.equal(await card.getByLabel('Estado do pagamento').inputValue(), 'partial70');
    assert.match(await card.getByLabel('Valor em falta', { exact: true }).inputValue(), /94,50/);
    await card.getByLabel('Data prevista do restante pagamento').fill('2026-10-13');
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await page.waitForFunction(() => document.querySelector('.service-detail-payment-actions button.command-button')?.textContent.includes('Guardar pagamento'));
    assert.equal(f.writes.length, 1); assert.equal(f.stored.paidAmount, 157.5); assert.equal(f.stored.billingStatus, 'partial70');
    assert.equal(f.stored.billingPaymentDate, null);
    await card.getByRole('button', { name: 'Registar pagamento restante' }).click();
    assert.equal(await card.getByLabel('Valor restante recebido').inputValue(), '94,5');
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await card.getByText('Indica a data efetiva do recebimento.', { exact: true }).waitFor();
    assert.equal(f.writes.length, 1);
    await card.getByLabel('Data efetiva do recebimento').fill('2026-10-14');
    await card.getByLabel('Valor restante recebido').fill('90');
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await card.getByText(/Para marcar como Pago/).waitFor(); assert.equal(f.writes.length, 1);
    await card.getByLabel('Valor restante recebido').fill('94,50');
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await page.waitForFunction(() => document.querySelector('.service-detail-payment-grid select')?.value === 'paid'
      && !document.querySelector('.service-detail-payment-card .form-error'));
    assert.equal(f.stored.paidAmount, 252); assert.equal(f.stored.signaledAmount, 157.5);
    assert.equal(f.stored.signaledAt, '2026-10-09'); assert.equal(f.stored.remainingPaymentDate, '2026-10-13');
    assert.equal(f.stored.billingPaymentDate, '2026-10-14');
    await page.goto(`${base}/services/42?tab=costs`);
    await card.waitFor();
    assert.match(await card.getByLabel('Valor em falta', { exact: true }).inputValue(), /0,00/);
    assert.equal(await card.getByLabel('Data da sinalização').inputValue(), '2026-10-09');
    assert.equal(await card.getByLabel('Data efetiva do recebimento').inputValue(), '2026-10-14');
    assert.equal(await card.getByLabel('Data prevista do restante pagamento').inputValue(), '2026-10-13');
    assert.equal(await card.getByLabel('Valor restante recebido').inputValue(), '94,5');
    assert.match(await card.getByLabel('Total recebido').inputValue(), /252,00/);
    await card.getByRole('button', { name: 'Guardar pagamento' }).click();
    await page.waitForFunction(() => document.querySelector('.service-detail-payment-actions button.command-button')?.textContent.includes('Guardar pagamento'));
    assert.equal(f.stored.paidAmount, 252); assert.equal(clientPaymentSummary(f.stored).outstanding, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await card.locator('button').evaluateAll((buttons) => buttons.some((button) => button.scrollWidth > button.clientWidth + 1)), false);
    await card.screenshot({ path: `${output}/paid-${width}.png` });
    await f.context.close();
    console.log(`Partial receipt, actual settlement, validation, reopening, preserved history and layout passed at ${width}px`);
  }
  const legacy = await setup(390, { billingStatus: 'paid', paidAmount: 0, billingPaymentDate: null });
  assert.equal(await legacy.card.getByLabel('Valor restante recebido').inputValue(), '94,5');
  assert.equal(await legacy.card.getByLabel('Data efetiva do recebimento').inputValue(), '');
  assert.equal(legacy.writes.length, 0); assert.equal(legacy.stored.paidAmount, 0);
  await legacy.context.close();
  const edit = await setup(390, { billingStatus: 'paid', paidAmount: 252, billingPaymentDate: '2026-10-14',
    externalCosts: '[{"type":"Catering","supplier":"QA","costAmount":200,"marginPercent":26,"vatType":"none"}]',
    totalCost: 200, taxAmount: 0, vatRateSnapshot: 0 });
  await edit.page.goto(`${base}/services?serviceId=42`);
  const dialog = edit.page.getByRole('dialog', { name: 'Pagamento cliente QA', exact: true });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(edit.writes.length, 1);
  assert.equal(Object.hasOwn(edit.writes[0], 'signaledAt'), false);
  assert.equal(Object.hasOwn(edit.writes[0], 'remainingPaymentDate'), false);
  assert.equal(Object.hasOwn(edit.writes[0], 'signaledAmount'), false);
  assert.equal(edit.stored.billingPaymentDate, '2026-10-14', 'Ordinary editing must not clear the actual receipt date');
  await edit.context.close();
  assert.deepEqual(errors, []);
  console.log('Legacy consultation and ordinary event editing preserve receipt history; no real application data touched.');
} finally { await browser.close(); }
