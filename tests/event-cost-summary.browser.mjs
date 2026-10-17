// Isolated browser fixtures only. All API requests are intercepted; no real records are updated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/event-cost-summary';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-10-15T12:00:00Z');
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
const errors = [];
function fixture() {
  const client = { id: 1, name: 'FIC Restaurante', billingMethod: 'per_event', paymentTerm: 'days_15', roleRates: '[{"role":"Emp.Mesa","rate":10}]' };
  const event = { id: 42, name: 'FIC Restaurante - FIXOS', date: '2026-10-16', status: 'finalized', statusMode: 'manual',
    startTime: '10:00', endTime: '00:00', billingStatus: 'pending', requiredRoles: '[{"role":"Emp.Mesa","qty":2,"agreedRate":10}]',
    clientId: 1, client, vatRateSnapshot: 0, assignments: [1, 2].map((id) => ({ id, eventId: 42, collaboratorId: id, role: 'Emp.Mesa',
      assignmentDate: '2026-10-16', status: 'confirmed', hourlyRate: 8, checkIn: '10:00', checkOut: '00:00',
      clientCheckIn: '10:00', clientCheckOut: '00:00', validationStatus: 'validated', paymentStatus: 'unpaid',
      collaborator: { id, name: id === 1 ? 'Alana Brandao Santos QA' : 'Allef Vinicius Souza QA', hourlyRate: 8, includeVat: false } })),
    workLocations: [], externalCosts: JSON.stringify(normalizeExternalCosts([{ id: 'partner', type: 'Aluguer', supplier: 'alugaqui',
      description: 'pratos e travessas', costAmount: 430, marginPercent: 0, vatType: 'standard_23' }])) };
  return { ...event, ...calculateEventTotals(event, event.assignments) };
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'qa', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'cost-summary-qa',
    })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    let stored = fixture(); const before = structuredClone(stored), writes = [];
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: {} }); }
      return route.fulfill({ json: url.pathname === '/api/services' ? [stored] : url.pathname === '/api/clients' ? [stored.client]
        : url.pathname.startsWith('/api/collaborators') && !url.pathname.endsWith('/roles') ? stored.assignments.map((row) => row.collaborator) : [] });
    });
    const card = page.locator('.service-detail-cost-summary');
    const metrics = card.locator('[data-finance-metric]');
    async function metric(label, expected) {
      const item = card.locator(`[data-finance-metric="${label}"]`);
      await item.waitFor(); assert.equal(await item.textContent(), expected, label);
    }
    const openCosts = async () => { await page.goto(`${base}/services/42?tab=costs`); await card.waitFor(); };
    await openCosts();
    const comparison = card.getByRole('table', { name: 'Comparação de custos internos e valores cobrados ao cliente' });
    assert.deepEqual(await comparison.locator('thead th').allTextContents(),
      ['Componente', 'Custos internos', 'Cobrado ao clienteSem IVA de venda']);
    assert.deepEqual(await comparison.locator('tbody th').allTextContents(), ['Staff', 'Parceiros']);
    const leftBounds = await comparison.locator('tbody tr').first().locator('td').nth(0).boundingBox();
    const rightBounds = await comparison.locator('tbody tr').first().locator('td').nth(1).boundingBox();
    assert.ok(leftBounds.x + leftBounds.width <= rightBounds.x + 1, 'cost and sale values remain side by side');
    assert.ok(Math.abs(leftBounds.y - rightBounds.y) < 1, 'component values share the same row');
    for (const [label, value] of [['Custo Staff', 224], ['Staff cobrado ao cliente', 280], ['Custo Real Parceiros', 430],
      ['Parceiros cobrados ao cliente', 430], ['Venda sem IVA', 710], ['IVA de venda', 98.9], ['Receita com IVA', 808.9], ['Despesas', 654], ['Margem €', 56]]) {
      await metric(label, money(value));
    }
    await metric('Horas Reais', '28:00h'); await metric('Horas Faturáveis', '28:00h'); await metric('Margem %', '6,9%');
    assert.equal(await card.getByText('Sobre receita com IVA', { exact: true }).count(), 1);
    assert.equal(await card.getByText('Total a cobrar ao cliente', { exact: true }).count(), 1);
    assert.equal(await metrics.count(), 12);
    assert.equal(await page.locator('.service-detail-payment-card [data-payment-metric="total"] .payment-metric-gross').textContent(), money(808.9));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await card.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
    const clipped = await card.locator('th, td, dt, dd, .event-finance-result > div, .event-finance-hours span').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent));
    assert.deepEqual(clipped, []);
    await card.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await card.screenshot({ path: `${output}/summary-${width}.png` });
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    await page.locator('.finance-client-summary-row').filter({ hasText: 'FIC Restaurante' }).click();
    const eventRow = page.locator('.finance-client-event-row').filter({ hasText: 'FIC Restaurante - FIXOS' });
    await eventRow.waitFor(); assert.ok((await eventRow.textContent()).includes(money(808.9)));
    await eventRow.getByRole('button', { name: 'Ver resumo de FIC Restaurante - FIXOS' }).click();
    const modal = page.getByRole('dialog', { name: 'Resumo do Evento/Serviço' }); await modal.waitFor();
    const components = modal.locator('.finance-event-reconciliation__component');
    assert.equal(await components.filter({ hasText: 'Serviços detalhados por dia' }).locator(':scope > strong').textContent(), money(280));
    assert.equal(await components.filter({ hasText: 'Extras faturáveis' }).locator(':scope > strong').textContent(), `+${money(430)}`);
    assert.equal(await components.filter({ hasText: 'IVA / impostos' }).locator(':scope > strong').textContent(), `+${money(98.9)}`);
    await page.goto(`${base}/finance?area=staff`);
    await page.locator('.finance-month-control').first().getByLabel(/^Mês/).selectOption('11');
    await page.getByRole('tab', { name: /^Todos os serviços/ }).click();
    const groups = page.locator('.finance-staff-payment-group-row'); await groups.nth(1).waitFor();
    assert.equal(await groups.count(), 2);
    for (let index = 0; index < 2; index += 1) {
      const group = groups.nth(index);
      assert.equal(await group.locator(':scope > td').nth(5).textContent(), money(112));
      await group.getByRole('button', { name: /^Consultar serviços/ }).click();
      const row = page.locator('.finance-staff-payment-detail-table tbody tr'); await row.waitFor();
      assert.equal(await row.locator(':scope > td').nth(6).textContent(), money(8));
      assert.equal(await row.locator('.finance-pay-total').textContent(), money(112));
    }
    assert.deepEqual(stored, before); assert.deepEqual(writes, []);
    stored = fixture(); stored.vatRateSnapshot = 23; Object.assign(stored, calculateEventTotals(stored, stored.assignments));
    await openCosts(); await metric('Venda sem IVA', money(710)); await metric('IVA de venda', money(163.3));
    await metric('Receita com IVA', money(873.3)); await metric('Margem €', money(56));
    stored = fixture(); stored.externalCosts = JSON.stringify(normalizeExternalCosts([{ id: 'partner', type: 'Aluguer', costAmount: 430, marginPercent: 20, vatType: 'standard_23' }]));
    Object.assign(stored, calculateEventTotals(stored, stored.assignments));
    await openCosts(); await metric('Parceiros cobrados ao cliente', money(516)); await metric('Receita com IVA', money(914.68));
    await metric('Custo Staff', money(224)); await metric('Staff cobrado ao cliente', money(280)); await metric('Margem €', money(142));
    stored = fixture(); stored.requiredRoles = '[{"role":"Emp.Mesa","qty":2,"agreedRate":0}]'; stored.client.roleRates = '[]'; stored.totalRevenue = 900;
    await openCosts(); await metric('Staff cobrado ao cliente', 'Por discriminar'); await metric('Receita com IVA', money(900));
    await metric('Valor por discriminar no total guardado', money(371.1));
    stored = fixture(); stored.assignments = []; stored.requiredRoles = '[]';
    Object.assign(stored, calculateEventTotals(stored, []));
    await openCosts(); await metric('Custo Staff', money(0)); await metric('Custo Real Parceiros', money(430));
    await metric('Receita com IVA', money(528.9)); await metric('Margem €', money(0));
    stored = fixture();
    for (const assignment of stored.assignments) assignment.hourlyRate = 100;
    Object.assign(stored, calculateEventTotals(stored, stored.assignments));
    await openCosts(); await metric('Margem €', money(-2520));
    assert.equal(await card.locator('.event-finance-result.service-detail-profit--negative').count(), 1);
    stored = fixture(); stored.travelExpenseEnabled = true; stored.travelExpenseAmount = 100;
    Object.assign(stored, calculateEventTotals(stored, stored.assignments));
    await openCosts(); await metric('Deslocação cobrada ao cliente', money(100));
    await metric('Receita com IVA', money(908.9));
    stored = fixture(); stored.totalRevenue = 1234567.89; stored.totalCost = 1000000;
    await openCosts(); await metric('Receita com IVA', money(1234567.89));
    assert.equal(await card.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
    assert.deepEqual(await card.locator('th, td, dt, dd, .event-finance-result > div').evaluateAll((elements) => elements
      .filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent)), []);
    assert.deepEqual(writes, []);
    await context.close();
    console.log(`FIC cost/sale/VAT summary, Finance Clients 808.90, Staff 8/h and 112 each, markup, snapshots and responsive layout passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
