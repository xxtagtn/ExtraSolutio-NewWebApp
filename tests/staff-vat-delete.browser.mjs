// Financial browser fixtures only; every API request is intercepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { normalizeEvent, normalizeAssignment } from '../server/routes/crud.js';
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';
import { removeExternalCost } from '../src/utils/externalCostEditing.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/staff-vat-delete'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
const now = new Date('2026-10-15T12:00:00Z'), errors = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'vat-delete-qa' })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    const client = { id: 1, name: 'FIC Restaurante QA', billingMethod: 'per_event', paymentTerm: 'days_15', roleRates: '[{"role":"Emp.Mesa","rate":10}]' };
    let stored = { id: 42, name: 'FIC Restaurante - FIXOS QA', clientId: 1, client, date: '2026-10-16', status: 'finalized', statusMode: 'manual',
      startTime: '10:00', endTime: '00:00', requiredRoles: '[{"role":"Emp.Mesa","qty":2,"agreedRate":10}]', workLocations: [],
      vatRateSnapshot: 0, staffVatRateSnapshot: null, billingStatus: 'partial70', signaledAmount: 100, paidAmount: 100,
      signaledAt: '2026-10-01', billingPaymentDate: null, remainingPaymentDate: '2026-10-30', updatedAt: now.toISOString(),
      assignments: [1, 2].map((id) => ({ id, eventId: 42, collaboratorId: id, collaborator: { id, name: `Pessoa QA ${id}`, hourlyRate: 8 },
        assignmentDate: '2026-10-16', role: 'Emp.Mesa', status: 'confirmed', hourlyRate: 8, plannedCheckIn: '10:00', plannedCheckOut: '00:00',
        checkIn: '10:00', checkOut: '00:00', clientCheckIn: '10:00', clientCheckOut: '00:00', validatedCheckIn: '10:00',
        validatedCheckOut: '00:00', validationStatus: 'validated', paymentStatus: 'unpaid' })),
      externalCosts: JSON.stringify(normalizeExternalCosts([{ id: 'partner', type: 'Aluguer', supplier: 'Parceiro QA',
        costAmount: 430, marginPercent: 0, vatType: 'standard_23' }])) };
    const originalAssignments = structuredClone(stored.assignments);
    const recalculate = () => Object.assign(stored, calculateEventTotals(stored, stored.assignments)); recalculate();
    const writes = [], created = []; let failDelete = false, delayed = false, version = 0;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(4);
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() === 'GET') return route.fulfill({ json: path === '/services' ? [stored, ...created]
        : path === '/services/42' ? stored : path === '/clients' ? [client] : path === '/collaborators/roles' ? ['Emp.Mesa']
          : path.startsWith('/collaborators') ? stored.assignments.map((row) => row.collaborator) : path === '/settings' ? {} : [] });
      const payload = request.postDataJSON(); writes.push({ path, method: request.method(), payload });
      if (/^\/services\/\d+\/workflow\/synchronize$/.test(path)) {
        return route.fulfill({ json: Number(path.split('/')[2]) === 42 ? stored : created[0] });
      }
      if (path === '/services' && request.method() === 'POST') {
        const row = { ...normalizeEvent(payload), id: 43, assignments: [], workLocations: [] }; created.push(row); return route.fulfill({ json: row });
      }
      if (path === '/services/42/external-costs/partner' && request.method() === 'DELETE') {
        if (failDelete) { failDelete = false; return route.fulfill({ status: 409, json: { message: 'Este evento já possui uma fatura emitida.' } }); }
        if (payload.updatedAt !== stored.updatedAt) return route.fulfill({ status: 409, json: { message: 'O evento foi alterado.' } });
        if (delayed) await new Promise((done) => setTimeout(done, 250));
        stored.externalCosts = JSON.stringify(removeExternalCost(stored.externalCosts, 'partner').rows);
      } else if (path === '/services/42' && request.method() === 'PUT') {
        Object.assign(stored, normalizeEvent(payload));
      } else if (/^\/assignments\/\d+$/.test(path) && request.method() === 'PUT') {
        Object.assign(stored.assignments.find((row) => row.id === Number(path.split('/').at(-1))), normalizeAssignment(payload));
      } else throw new Error(`Unexpected write ${request.method()} ${path}`);
      stored.updatedAt = new Date(now.getTime() + ++version * 1000).toISOString(); recalculate();
      return route.fulfill({ json: path.startsWith('/assignments/') ? stored.assignments.find((row) => row.id === Number(path.split('/').at(-1))) : stored });
    });
    const form = page.getByRole('dialog');
    const checkbox = () => form.getByRole('checkbox', { name: /Aplicar IVA/ });
    const openEdit = async () => {
      await page.goto(`${base}/services?serviceId=42`); await form.waitFor();
      await form.locator('.service-tabs').getByRole('button', { name: 'Financeiro', exact: true }).click(); await checkbox().waitFor();
    };
    const previewRevenue = () => form.locator('.service-finance-grid > div').filter({ has: page.getByText('Receita', { exact: true }) }).locator('strong');
    const save = async () => { await form.getByRole('button', { name: 'Guardar', exact: true }).click(); await form.waitFor({ state: 'detached' }); };
    await openEdit(); assert.equal(await checkbox().isChecked(), false);
    await checkbox().check(); assert.equal((await previewRevenue().textContent()).replace(/\s/g, ''), money(873.3).replace(/\s/g, ''));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await form.locator('.service-staff-vat-control').screenshot({ path: `${output}/staff-vat-${width}.png` });
    await save(); assert.equal(stored.staffVatRateSnapshot, 23); assert.equal(stored.totalRevenue, 873.3);
    assert.equal(stored.paidAmount, 100); assert.equal(stored.signaledAmount, 100); assert.equal(stored.billingStatus, 'partial70');
    assert.deepEqual(stored.assignments.map((row) => [row.hourlyRate, row.checkIn, row.checkOut]), originalAssignments.map((row) => [row.hourlyRate, row.checkIn, row.checkOut]));
    await openEdit(); await checkbox().uncheck(); assert.equal((await previewRevenue().textContent()).replace(/\s/g, ''), money(808.9).replace(/\s/g, ''));
    await save(); assert.equal(stored.totalRevenue, 808.9); assert.equal(stored.taxAmount, 98.9);
    await openEdit(); await checkbox().check(); await save();
    await page.goto(`${base}/services/42?tab=costs`);
    const summary = page.locator('.service-detail-cost-summary'); await summary.waitFor();
    await summary.getByText(`Staff: ${money(64.4)}`, { exact: true }).waitFor();
    await summary.getByText(`Parceiros: ${money(98.9)}`, { exact: true }).waitFor();
    const payment = page.locator('.service-detail-payment-card');
    assert.equal(await payment.getByLabel('Valor total', { exact: true }).inputValue(), money(873.3));
    assert.equal(await payment.getByLabel('Valor em falta', { exact: true }).inputValue(), money(773.3));
    const reference = payment.getByLabel('Referência 70% e 30%'); assert.ok((await reference.textContent()).includes(money(611.31)));
    const external = page.locator('.service-detail-external-card');
    const remove = () => external.getByRole('button', { name: 'Eliminar custo externo Parceiro QA', exact: true }).click();
    const removal = page.getByRole('dialog', { name: 'Eliminar custo externo/parceiro?', exact: true });
    const beforeCancel = writes.length, original = structuredClone(stored);
    await remove(); await removal.waitFor();
    assert.equal(await page.locator('.service-detail-mobile-actions').count(), 0, 'background save actions are not exposed over the confirmation');
    await removal.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(writes.length, beforeCancel); assert.deepEqual(stored, original);
    await remove(); failDelete = true; await removal.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await removal.getByRole('alert').waitFor(); assert.deepEqual(stored, original);
    await removal.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await remove(); await removal.screenshot({ path: `${output}/delete-confirm-${width}.png` }); delayed = true;
    const beforeDelete = writes.filter((row) => row.method === 'DELETE').length;
    await removal.getByRole('button', { name: 'Eliminar', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await removal.waitFor({ state: 'detached' });
    assert.equal(writes.filter((row) => row.method === 'DELETE').length, beforeDelete + 1);
    await external.getByText('Sem custos externos registados', { exact: true }).waitFor();
    assert.equal(stored.totalRevenue, 344.4); assert.equal(stored.taxAmount, 64.4); assert.equal(stored.totalCost, 224);
    assert.equal(stored.paidAmount, 100); assert.equal(await payment.getByLabel('Valor em falta', { exact: true }).inputValue(), money(244.4));
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    await page.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    const financeRow = page.locator('.finance-client-event-row').filter({ hasText: stored.name }); await financeRow.waitFor();
    assert.ok((await financeRow.textContent()).includes(money(344.4)));
    await page.goto(`${base}/services`); await page.getByRole('button', { name: 'Novo Evento/Serviço', exact: true }).click();
    await form.waitFor(); await form.getByLabel('Evento / Serviço', { exact: true }).fill('Novo evento IVA QA');
    await form.getByLabel('Data', { exact: true }).fill('2026-10-17');
    await checkbox().check(); await save();
    assert.equal(created.length, 1); assert.equal(created[0].staffVatRateSnapshot, 23);
    stored.billingStatus = 'paid';
    await openEdit(); assert.equal(await checkbox().isDisabled(), false, 'prepayment is not invoice closure');
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    stored.billingStatus = 'invoiced';
    await openEdit(); assert.equal(await checkbox().isDisabled(), true);
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await context.close(); console.log(`Staff VAT create/edit/preview, preserved receipts/payroll, delete cancel/error/double-click, references and Finance passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
