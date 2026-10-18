// Real local API, disposable SQLite only. No production requests or schedulers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { issueSessionToken } from '../server/security/sessionTokens.js';
import { clientPaymentRecordPatch } from '../server/services/clientPaymentRecord.js';
import { readClientPaymentRecord } from '../src/utils/clientPaymentRecord.js';
import { receiptMovements } from '../src/utils/clientReceiptMovements.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'es-finance-manager-')), database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl; process.env.JWT_SECRET = 'finance-manager-browser-test-only';
const db = new PrismaClient({ datasourceUrl });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
const output = 'node_modules/.cache/finance-receipt-manager'; await mkdir(output, { recursive: true });
let prisma, server, browser;
const errors = [];
try {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], { encoding: 'utf8', env: process.env, windowsHide: true });
  assert.equal(migration.status, 0, migration.stderr);
  const sql = new DatabaseSync(database); sql.exec(migration.stdout); sql.close();
  const { apiRouter } = await import('../server/routes/index.js'); ({ prisma } = await import('../server/prisma.js'));
  const user = await db.user.create({ data: { name: 'QA', email: 'finance-manager-browser@example.test', role: 'admin', password: 'qa' } });
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  // The fixture browser clock is fixed; its local test token must cover that clock.
  const apiOrigin = `http://127.0.0.1:${server.address().port}`, token = issueSessionToken(user, { expiresIn: '365d' });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const apply = (event, patch) => db.event.update({ where: { id: event.id }, data: { ...patch, ...clientPaymentRecordPatch(event, patch) } });
  for (const width of [320, 390, 768, 1440]) {
    const client = await db.client.create({ data: { name: `Globo de prata QA ${width}`, billingMethod: 'per_event', paymentTerm: 'immediate' } });
    let event = await db.event.create({ data: { name: `Corporate - Globo de prata QA ${width}`, date: new Date('2026-10-10'), clientId: client.id,
      status: 'finalized', statusMode: 'manual', totalRevenue: 1745.37, taxAmount: 326.37, totalCost: 500, staffVatRateSnapshot: 23, vatRateSnapshot: 23,
      requiredRoles: '[{"role":"Emp.Mesa","qty":1,"agreedRate":15}]', billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, externalCosts: '[]' } });
    event = await apply(event, { billingStatus: 'partial70', paidAmount: 200, signaledAmount: 200, signaledAt: new Date('2026-10-10') });
    event = await apply(event, { billingStatus: 'paid', paidAmount: 1745.37, billingPaymentDate: new Date('2026-10-11') });
    event = await db.event.update({ where: { id: event.id }, data: { totalRevenue: 1763.82, taxAmount: 329.82 } });
    const original = readClientPaymentRecord(event.clientPaymentRecord);
    const prepaid = await db.event.create({ data: { name: `Prepaid in progress QA ${width}`, date: new Date('2026-10-10'), clientId: client.id,
      endDate: new Date('2099-12-20'), isContinuous: true, status: 'in_progress', statusMode: 'manual',
      totalRevenue: 100, totalCost: 100, paidAmount: 100, billingStatus: 'paid', requiredRoles: '[]',
      externalCosts: '[{"type":"Outro","supplier":"Partner QA","costAmount":100,"marginPercent":0,"vatType":"exempt"}]' } });
    const legacy = await db.event.create({ data: { name: `FIC invoiced legacy QA ${width}`, date: new Date('2026-10-15'), clientId: client.id,
      status: 'finalized', statusMode: 'manual', billingStatus: 'invoiced', totalRevenue: 295.2, taxAmount: 55.2,
      totalCost: 100, paidAmount: 0, signaledAmount: 0, requiredRoles: '[{"role":"Emp.Mesa","qty":4}]' } });
    const invoiced = await db.event.create({ data: { name: `FIC actual invoice QA ${width}`, date: new Date('2026-10-15'), clientId: client.id,
      status: 'finalized', statusMode: 'manual', billingStatus: 'invoiced', totalRevenue: 295.2, taxAmount: 55.2,
      totalCost: 100, paidAmount: 0, signaledAmount: 0, requiredRoles: '[{"role":"Emp.Mesa","qty":4}]' } });
    const invoice = await db.invoice.create({ data: { number: `FIC-QA-${width}`, eventId: invoiced.id, clientId: client.id,
      status: 'issued', issueDate: new Date('2026-10-15'), subtotal: 240, taxAmount: 55.2, total: 295.2 } });
    const allocationClient = await db.client.create({ data: { name: `Partner periods QA ${width}`, billingMethod: 'biweekly', paymentTerm: 'days_15' } });
    let allocationEvent = await db.event.create({ data: { name: `Cross-period partner QA ${width}`, clientId: allocationClient.id,
      date: new Date('2026-10-14'), endDate: new Date('2026-10-16'), isContinuous: true, status: 'finalized', statusMode: 'manual',
      totalRevenue: 738, totalCost: 600, taxAmount: 138, requiredRoles: '[]', billingStatus: 'pending',
      externalCosts: '[{"type":"Outro","supplier":"Partner QA","costAmount":600,"marginPercent":0,"vatType":"rate","vatRate":23}]' } });
    allocationEvent = await apply(allocationEvent, { billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100, signaledAt: new Date('2026-10-15') });
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((auth) => localStorage.setItem('extrasolutio.auth', JSON.stringify(auth)), {
      token, user: { id: user.id, name: user.name, role: 'admin' }, lastActivityAt: new Date('2026-10-17T12:00:00Z').getTime(), sessionId: `finance-manager-${width}`,
    });
    const page = await context.newPage(); await page.clock.install({ time: new Date('2026-10-17T12:00:00Z') });
    page.on('pageerror', (error) => errors.push(error.message)); let writes = 0;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') writes += 1;
      const response = await route.fetch({ url: `${apiOrigin}${url.pathname}${url.search}` }); return route.fulfill({ response });
    });
    await page.goto(`${base}/finance?area=clients&eventId=${event.id}`);
    const workspace = page.locator('.finance-client-workspace'); await workspace.waitFor();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    const eventRow = workspace.locator('.finance-client-event-row').filter({ hasText: event.name }); await eventRow.waitFor();
    assert.match(await eventRow.locator('.finance-client-missing').textContent(), /18,45/);
    assert.equal(await eventRow.getByText('Pagamento em falta', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Pagamento em falta', { exact: true }).count() + await page.getByText('Fatura vencida', { exact: true }).count(), await workspace.locator('.finance-client-missing').count(), 'Only events with a balance have alerts, never a global strip');
    const prepaidRow = workspace.locator('.finance-client-event-row').filter({ hasText: prepaid.name });
    assert.equal(await prepaidRow.getByText('Previsto totalmente recebido', { exact: true }).count(), 1, 'An advance payment never implies service completion');
    const bounds = await eventRow.evaluate((element) => {
      const row = element.getBoundingClientRect(), action = element.querySelector('.finance-client-event-action').getBoundingClientRect();
      return { rowRight: row.right, actionRight: action.right };
    });
    assert.ok(bounds.actionRight <= bounds.rowRight + 1, 'Receipt command must not overflow its event row');
    await eventRow.screenshot({ path: `${output}/row-${width}.png` });
    await eventRow.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Gerir recebimentos', exact: true }); await manager.waitFor();
    const metric = (name) => manager.locator(`[data-payment-metric="${name}"] .payment-metric-gross`);
    assert.match(await metric('received').textContent(), /1745,37/); assert.match(await metric('outstanding').textContent(), /18,45/);
    const beforeInvoice = writes;
    await manager.getByLabel('Estado financeiro', { exact: true }).selectOption('invoiced');
    assert.equal(await manager.getByLabel('Data de faturação / referência', { exact: true }).inputValue(), '2026-10-11', 'Configured per-event reference is calculated by the backend');
    assert.equal(writes, beforeInvoice, 'Selection alone does not persist an invoice date or status');
    await manager.locator('.finance-receipt-issue-form').getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(writes, beforeInvoice, 'Cancelling leaves financial state unchanged');
    await manager.getByLabel('Estado financeiro', { exact: true }).selectOption('invoiced');
    await manager.getByRole('button', { name: 'Guardar faturação', exact: true }).click();
    await manager.locator('.client-billing-periods header').getByText('Faturado', { exact: true }).waitFor();
    await manager.getByText('Estado financeiro guardado.', { exact: true }).waitFor();
    await eventRow.locator('.finance-client-deadline').getByText('Vencida há 6 dias', { exact: true }).waitFor();
    assert.equal(await eventRow.getByText('Faturado', { exact: true }).count(), 1, 'Selection updates table without a second save action');
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.reload(); await workspace.waitFor();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    await eventRow.getByText('Faturado', { exact: true }).waitFor();
    await eventRow.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click(); await manager.waitFor();
    await page.waitForFunction(() => document.querySelector('select[aria-label="Estado financeiro"]')?.value === 'invoiced');
    await manager.getByRole('button', { name: 'Editar emissão', exact: true }).click();
    assert.equal(await manager.getByLabel('Data de faturação / referência', { exact: true }).inputValue(), '2026-10-11');
    assert.equal(await manager.getByLabel('Data de faturação / referência', { exact: true }).evaluate((input) => input.readOnly), true);
    await manager.getByRole('button', { name: 'Guardar faturação', exact: true }).click();
    await manager.locator('.client-billing-periods').getByText('Vencida há 6 dias', { exact: true }).waitFor();
    assert.match(page.url(), /\/finance/);
    await manager.screenshot({ path: `${output}/manager-${width}.png` });
    await manager.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Registar recebimento', exact: true });
    await editor.getByLabel('Valor recebido', { exact: true }).fill('10'); await editor.getByLabel('Data do recebimento', { exact: true }).fill('2026-10-17');
    await editor.getByRole('button', { name: 'Guardar recebimento', exact: true }).click(); await manager.waitFor();
    assert.match(await metric('outstanding').textContent(), /8,45/); await manager.locator('.client-billing-periods header').getByText('Faturado', { exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    await editor.getByLabel('Data do recebimento', { exact: true }).fill('2026-10-17');
    const before = writes;
    await editor.getByRole('button', { name: 'Guardar recebimento', exact: true }).evaluate((button) => { button.click(); button.click(); }); await manager.waitFor();
    assert.equal(writes, before + 1); await manager.locator('.finance-receipt-manager-heading').getByText('Pago', { exact: true }).waitFor();
    assert.match(await metric('outstanding').textContent(), /0,00/);
    assert.equal(await manager.getByLabel('Estado financeiro', { exact: true }).locator('option[value="invoiced"]').evaluate((option) => option.disabled), false, 'Billing and actual payment are independent');
    let saved = await db.event.findUnique({ where: { id: event.id } });
    assert.equal(Number(saved.paidAmount), 1763.82); assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord).entries.slice(0, 2), original.entries);
    assert.equal(saved.status, 'finalized'); assert.equal(Number(saved.totalRevenue), 1763.82); assert.equal(Number(saved.taxAmount), 329.82);
    assert.equal(await eventRow.count(), 1, 'Payment alone does not archive the event');
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Arquivar serviço', exact: true }).click();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).click({ trial: true });
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.equal(await workspace.locator('.finance-client-event-row').filter({ hasText: event.name }).count(), 0, 'Fully settled ready event leaves active workspace');
    await page.getByRole('button', { name: 'Arquivo', exact: true }).click();
    const archiveClient = page.locator('.finance-client-row').filter({ hasText: client.name }); await archiveClient.first().click();
    const archived = page.locator('.finance-client-service').filter({ hasText: event.name }); await archived.waitFor();
    await archived.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click(); await manager.waitFor();
    const lastRow = manager.locator('.finance-receipt-list li').last(); await lastRow.getByRole('button', { name: 'Reverter recebimento', exact: true }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverter recebimento?', exact: true });
    await reverse.getByRole('button', { name: 'Reverter recebimento', exact: true }).click(); await manager.waitFor();
    assert.match(await metric('outstanding').textContent(), /8,45/); await manager.locator('.client-billing-periods header').getByText('Faturado', { exact: true }).waitFor();
    saved = await db.event.findUnique({ where: { id: event.id } }); assert.equal(receiptMovements(saved.clientPaymentRecord).rows.at(-1).voided, 'reverse');
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    if (!await workspace.locator('.finance-client-event-row').filter({ hasText: event.name }).isVisible()) await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    await workspace.locator('.finance-client-event-row').filter({ hasText: event.name }).waitFor();
    await page.reload(); await workspace.waitFor();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    assert.match(await workspace.locator('.finance-client-event-row').filter({ hasText: event.name }).textContent(), /8,45/);
    const legacyRow = workspace.locator('.finance-client-event-row').filter({ hasText: legacy.name });
    await legacyRow.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click(); await manager.waitFor();
    await manager.getByRole('button', { name: 'Registar emissão', exact: true }).click();
    assert.equal(await manager.getByLabel('Data de faturação / referência', { exact: true }).inputValue(), '2026-10-16');
    await manager.getByRole('button', { name: 'Guardar faturação', exact: true }).click();
    await manager.locator('.client-billing-periods').getByText('Vencida há 1 dia', { exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Liquidar saldo', exact: true }).click(); await editor.waitFor();
    assert.equal(await editor.getByLabel('Valor recebido', { exact: true }).inputValue(), '295,2');
    assert.equal(await editor.getByLabel('Tipo do movimento', { exact: true }).inputValue(), 'remaining');
    await editor.getByLabel('Data do recebimento', { exact: true }).fill('2026-10-17');
    await editor.getByRole('button', { name: 'Guardar recebimento', exact: true }).click(); await manager.waitFor();
    await manager.locator('.finance-receipt-manager-heading').getByText('Pago', { exact: true }).waitFor();
    saved = await db.event.findUnique({ where: { id: legacy.id } });
    assert.equal(Number(saved.paidAmount), 295.2); assert.equal(saved.status, 'finalized'); assert.equal(Number(saved.taxAmount), 55.2);
    assert.equal(readClientPaymentRecord(saved.clientPaymentRecord).legacyInvoiced, true);
    const paidEntries = receiptMovements(saved.clientPaymentRecord).rows;
    assert.equal(paidEntries.length, 1); assert.equal(paidEntries[0].amount, 295.2); assert.equal(paidEntries[0].type, 'remaining');
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Arquivar serviço', exact: true }).click();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).click({ trial: true });
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.equal(await legacyRow.count(), 0, 'Finalized legacy event archives after the real payment');
    await page.reload(); await workspace.waitFor();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: client.name }).click();
    assert.equal(await legacyRow.count(), 0, 'Legacy archive persists after reload');
    const invoiceRow = workspace.locator('.finance-client-event-row').filter({ hasText: invoiced.name });
    await invoiceRow.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click(); await manager.waitFor();
    assert.equal(await manager.getByRole('button', { name: 'Liquidar saldo', exact: true }).count(), 0, 'Issued invoices retain their own settlement path');
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Marcar fatura como paga', exact: true }).click();
    await manager.locator('.finance-receipt-manager-heading').getByText('Pago', { exact: true }).waitFor();
    assert.equal((await db.invoice.findUnique({ where: { id: invoice.id } })).status, 'paid');
    saved = await db.event.findUnique({ where: { id: invoiced.id } });
    assert.equal(Number(saved.paidAmount), 295.2); assert.equal(saved.status, 'finalized'); assert.equal(Number(saved.taxAmount), 55.2);
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Arquivar serviço', exact: true }).click();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).click({ trial: true });
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.equal(await invoiceRow.count(), 0, 'Paid issued invoice and ready event archive through the existing workflow');
    await workspace.locator('.finance-client-summary-row').filter({ hasText: allocationClient.name }).click();
    const periodRows = workspace.locator('.finance-client-event-row').filter({ hasText: allocationEvent.name });
    assert.equal(await periodRows.count(), 2); assert.match(await periodRows.first().textContent(), /Por repartir/);
    await periodRows.first().getByRole('button', { name: 'Gerir recebimentos', exact: true }).click(); await manager.waitFor();
    await manager.getByRole('button', { name: 'Repartir faturação', exact: true }).click();
    for (const [index, gross, vat, received] of [[1, '295,20', '55,20', '100'], [2, '442,80', '82,80', '0']]) {
      await manager.getByLabel(`Valor global com IVA ${index}`, { exact: true }).fill(gross);
      await manager.getByLabel(`IVA incluído ${index}`, { exact: true }).fill(vat);
      await manager.getByLabel(`Recebido neste período ${index}`, { exact: true }).fill(received);
    }
    await manager.screenshot({ path: `${output}/allocation-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await manager.getByRole('button', { name: 'Guardar repartição', exact: true }).click();
    await manager.locator('.client-billing-allocation').waitFor({ state: 'detached' });
    assert.equal(await manager.getByText('Repartição por confirmar. Os totais e os recebimentos do serviço estão preservados.', { exact: true }).count(), 0);
    saved = await db.event.findUnique({ where: { id: allocationEvent.id }, include: { assignments: true } });
    assert.equal(Number(saved.totalRevenue), 738); assert.equal(Number(saved.paidAmount), 100); assert.equal(saved.assignments.length, 0);
    assert.equal(readClientPaymentRecord(saved.clientPaymentRecord).billingAllocation.periods.length, 2);
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.match(await periodRows.first().textContent(), /295,20/); assert.match(await periodRows.last().textContent(), /442,80/);
    await page.reload(); await workspace.waitFor();
    await workspace.locator('.finance-client-summary-row').filter({ hasText: allocationClient.name }).click();
    assert.equal(await periodRows.count(), 2); assert.match(await periodRows.first().textContent(), /295,20/);
    assert.match(page.url(), /\/finance/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await context.close(); console.log(`Finance manager: balances, manual state, cash, legacy/invoice settlement, archive, reversal and persistence passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); if (server) await new Promise((done) => server.close(done));
  await prisma?.$disconnect(); await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory);
}
