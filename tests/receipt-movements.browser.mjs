// Real local API + disposable database. No requests reach production or the normal API.
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
import { normalizeExternalCosts } from '../src/utils/externalCosts.js';
import { paymentFinancialSnapshot } from '../src/utils/clientPaymentAdjustment.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'es-receipt-browser-')), database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
process.env.DATABASE_URL = datasourceUrl; process.env.JWT_SECRET = 'receipt-browser-test-only';
const db = new PrismaClient({ datasourceUrl });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
const output = 'node_modules/.cache/receipt-movements'; await mkdir(output, { recursive: true });
let prisma, server, browser, sequence = 0;
const errors = [];
try {
  const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], { encoding: 'utf8', env: process.env, windowsHide: true });
  assert.equal(migration.status, 0, migration.stderr);
  const sql = new DatabaseSync(database); sql.exec(migration.stdout); sql.close();
  const { apiRouter } = await import('../server/routes/index.js'); ({ prisma } = await import('../server/prisma.js'));
  const user = await db.user.create({ data: { name: 'QA', email: 'receipts-browser@example.test', role: 'admin', password: 'qa' } });
  const client = await db.client.create({ data: { name: 'Cliente QA' } });
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  const token = issueSessionToken(user);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const fixture = async (patch = {}) => db.event.create({ data: { name: `Recebimentos QA ${++sequence}`, date: new Date('2026-10-16'),
    status: 'finalized', statusMode: 'manual', clientId: client.id, totalRevenue: 1392.36, taxAmount: 260.36, totalCost: 800,
    staffVatRateSnapshot: 23, vatRateSnapshot: 23, requiredRoles: '[{"role":"Emp.Mesa","qty":3,"agreedRate":14}]',
    billingStatus: 'pending', paidAmount: 0, signaledAmount: 0, externalCosts: '[]', ...patch } });
  const apply = (event, patch) => db.event.update({ where: { id: event.id }, data: { ...patch, ...clientPaymentRecordPatch(event, patch) } });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((auth) => localStorage.setItem('extrasolutio.auth', JSON.stringify(auth)), {
      token, user: { id: user.id, name: user.name, role: 'admin' }, lastActivityAt: Date.now(), sessionId: `receipt-browser-${width}`,
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    let writes = 0;
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (url.pathname.startsWith('/api/services')) {
        if (request.method() !== 'GET') writes += 1;
        const response = await route.fetch({ url: `${apiOrigin}${url.pathname}${url.search}` });
        return route.fulfill({ response });
      }
      return route.fulfill({ json: [] });
    });
    let event = await fixture();
    event = await apply(event, { billingStatus: 'partial70', paidAmount: 200, signaledAmount: 200, signaledAt: new Date('2026-10-16') });
    event = await apply(event, { billingStatus: 'paid', paidAmount: 1392.36, billingPaymentDate: new Date('2026-10-20') });
    event = await db.event.update({ where: { id: event.id }, data: { totalRevenue: 1426.8, taxAmount: 266.8 } });
    const original = readClientPaymentRecord(event.clientPaymentRecord);
    const card = page.locator('.service-detail-payment-card'), rows = card.locator('.payment-overview-receipts > ul > li');
    await page.goto(`${base}/services/${event.id}?tab=costs`); await card.waitFor();
    assert.match(await card.locator('[data-payment-metric="outstanding"] .payment-metric-base').textContent(), /28,00/);
    await card.locator('.payment-overview-receipts > summary').click();
    assert.equal(await rows.count(), 2);
    const remainder = rows.filter({ hasText: 'Restante recebido' });
    await remainder.locator('.receipt-actions > summary').click();
    await page.screenshot({ path: `${output}/menu-${width}.png`, fullPage: true });
    await remainder.getByRole('button', { name: 'Editar', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Editar recebimento', exact: true });
    await editor.getByLabel('Valor recebido', { exact: true }).fill('1200,00');
    await editor.getByLabel('Descrição', { exact: true }).fill('Transferência corrigida QA');
    const before = writes;
    const position = await page.evaluate(() => window.scrollY);
    await editor.getByRole('button', { name: 'Guardar recebimento', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await editor.waitFor({ state: 'detached' }); assert.equal(writes, before + 1);
    const expectedPosition = await page.evaluate((previous) => Math.min(previous, document.documentElement.scrollHeight - innerHeight), position);
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - expectedPosition) < 2, 'Individual edit preserves page position');
    assert.equal(await card.locator('.payment-overview-receipts').getAttribute('open'), '');
    let saved = await db.event.findUnique({ where: { id: event.id } });
    assert.equal(Number(saved.paidAmount), 1400); assert.equal(Number(saved.signaledAmount), 200);
    assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord).entries.slice(0, 2), original.entries);
    assert.match(await card.locator('[data-payment-metric="outstanding"] .payment-metric-gross').textContent(), /26,80/);
    assert.match(await card.locator('[data-payment-metric="outstanding"] .payment-metric-base').textContent(), /21,79/);
    assert.equal(await rows.count(), 2, 'Calculated balance never becomes a received movement');
    await card.screenshot({ path: `${output}/corrected-${width}.png` });
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const additional = page.getByRole('dialog', { name: 'Registar pagamento adicional', exact: true });
    await additional.getByLabel('Data do novo recebimento').fill('2026-10-25');
    await additional.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    await additional.waitFor({ state: 'detached' }); assert.equal(await rows.count(), 3);
    const adjustment = rows.filter({ hasText: 'Acerto final' });
    await adjustment.locator('.receipt-actions > summary').click(); await adjustment.getByRole('button', { name: 'Reverter', exact: true }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverter recebimento?', exact: true });
    await reverse.getByRole('button', { name: 'Cancelar', exact: true }).click();
    saved = await db.event.findUnique({ where: { id: event.id } }); assert.equal(Number(saved.paidAmount), 1426.8);
    await adjustment.locator('.receipt-actions > summary').click(); await adjustment.getByRole('button', { name: 'Reverter', exact: true }).click();
    await reverse.getByRole('button', { name: 'Reverter recebimento', exact: true }).click(); await reverse.waitFor({ state: 'detached' });
    saved = await db.event.findUnique({ where: { id: event.id } }); assert.equal(Number(saved.paidAmount), 1400);
    assert.match(await adjustment.textContent(), /Revertido em/);
    assert.deepEqual(receiptMovements(saved.clientPaymentRecord).rows.slice(0, 2).map((row) => row.amount), [200, 1200]);
    await card.locator('.payment-overview-corrections > summary').click();
    await card.locator('.receipt-audit').getByText('Recebimento corrigido', { exact: true }).waitFor();
    await card.locator('.receipt-audit').getByText('Recebimento revertido', { exact: true }).waitFor();
    await card.locator('.receipt-audit').getByText('Descrição: Sem descrição → Transferência corrigida QA', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await card.screenshot({ path: `${output}/history-${width}.png` });
    await adjustment.locator('.receipt-actions > summary').click();
    assert.equal(await adjustment.getByRole('button', { name: 'Editar', exact: true }).count(), 0);
    assert.equal(await adjustment.getByRole('button', { name: 'Reverter', exact: true }).count(), 0);
    await adjustment.getByRole('button', { name: 'Eliminar', exact: true }).click();
    const removeReversed = page.getByRole('dialog', { name: 'Eliminar recebimento?', exact: true });
    await removeReversed.getByText(/sem alterar os totais/).waitFor();
    await removeReversed.getByRole('button', { name: 'Eliminar recebimento', exact: true }).click(); await removeReversed.waitFor({ state: 'detached' });
    assert.equal(await adjustment.count(), 0);
    assert.equal(Number((await db.event.findUnique({ where: { id: event.id } })).paidAmount), 1400);
    // Deletion of one receipt leaves other cash and the immutable journal intact.
    await remainder.locator('.receipt-actions > summary').click(); await remainder.getByRole('button', { name: 'Eliminar', exact: true }).click();
    const deleteRemainder = page.getByRole('dialog', { name: 'Eliminar recebimento?', exact: true });
    await deleteRemainder.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(Number((await db.event.findUnique({ where: { id: event.id } })).paidAmount), 1400);
    await remainder.locator('.receipt-actions > summary').click(); await remainder.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await deleteRemainder.getByRole('button', { name: 'Eliminar recebimento', exact: true }).click(); await deleteRemainder.waitFor({ state: 'detached' });
    saved = await db.event.findUnique({ where: { id: event.id } });
    assert.equal(Number(saved.paidAmount), 200); assert.equal(Number(saved.signaledAmount), 200);
    assert.equal(await remainder.count(), 0, 'Deleted receipt leaves the regular list');
    await card.locator('.receipt-audit').getByText('Recebimento eliminado', { exact: true }).last().waitFor();
    assert.deepEqual(readClientPaymentRecord(saved.clientPaymentRecord).entries.slice(0, 2), original.entries);
    await card.screenshot({ path: `${output}/deleted-${width}.png` });
    // A first signal can also be deleted, with its audit retained.
    let simple = await fixture({ totalRevenue: 984, taxAmount: 184 });
    simple = await apply(simple, { billingStatus: 'partial70', paidAmount: 100, signaledAmount: 100, signaledAt: new Date('2026-10-16') });
    await page.goto(`${base}/services/${simple.id}?tab=costs`); await card.waitFor(); await card.locator('.payment-overview-receipts > summary').click();
    await rows.first().locator('.receipt-actions > summary').click(); await rows.first().getByRole('button', { name: 'Eliminar', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Eliminar recebimento?', exact: true });
    await remove.getByRole('button', { name: 'Eliminar recebimento', exact: true }).click(); await remove.waitFor({ state: 'detached' });
    assert.equal(Number((await db.event.findUnique({ where: { id: simple.id } })).paidAmount), 0);
    assert.equal(await rows.count(), 0);
    await card.locator('.payment-overview-corrections > summary').click();
    await card.locator('.receipt-audit').getByText('Recebimento eliminado', { exact: true }).waitFor();
    // Old uniform-tax receipts keep net/gross values after an individual reversal.
    let legacy = await fixture({ totalRevenue: 364.08, taxAmount: 68.08, paidAmount: 364.08,
      signaledAmount: 123, billingStatus: 'paid', signaledAt: new Date('2026-10-16'), billingPaymentDate: new Date('2026-10-20') });
    legacy = await db.event.update({ where: { id: legacy.id }, data: { clientPaymentRecord: JSON.stringify({ version: 1,
      settledFinancials: paymentFinancialSnapshot(legacy), entries: [
        { id: 'old-signal', type: 'signal', amount: 123, source: 'legacy', receivedAt: '2026-10-16' },
        { id: 'old-remaining', type: 'remaining', amount: 241.08, source: 'legacy', receivedAt: '2026-10-20' },
      ] }) } });
    await page.goto(`${base}/services/${legacy.id}?tab=costs`); await card.waitFor();
    const metric = (name, part) => card.locator(`[data-payment-metric="${name}"] .payment-metric-${part}`);
    assert.match(await metric('total', 'base').textContent(), /296,00/);
    assert.match(await metric('received', 'base').textContent(), /296,00/);
    assert.match(await metric('outstanding', 'base').textContent(), /0,00/);
    await card.locator('.payment-overview-totals').screenshot({ path: `${output}/compact-${width}.png` });
    await card.locator('.payment-overview-receipts > summary').click();
    await rows.first().locator('.receipt-actions > summary').click(); await rows.first().getByRole('button', { name: 'Reverter', exact: true }).click();
    await reverse.getByRole('button', { name: 'Reverter recebimento', exact: true }).click(); await reverse.waitFor({ state: 'detached' });
    assert.match(await metric('received', 'base').textContent(), /196,00/);
    assert.match(await metric('received', 'gross').textContent(), /241,08/);
    assert.match(await metric('outstanding', 'base').textContent(), /100,00/);
    assert.match(await metric('outstanding', 'gross').textContent(), /123,00/);
    await page.reload();
    await page.getByRole('button', { name: 'Custos', exact: true }).click(); await card.waitFor();
    assert.match(await metric('received', 'base').textContent(), /196,00/);
    await card.locator('.payment-overview-receipts > summary').click();
    await rows.nth(1).locator('.receipt-actions > summary').click(); await rows.nth(1).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await remove.getByRole('button', { name: 'Eliminar recebimento', exact: true }).click(); await remove.waitFor({ state: 'detached' });
    assert.match(await metric('received', 'base').textContent(), /0,00/);
    assert.match(await metric('outstanding', 'base').textContent(), /296,00/);
    assert.match(await metric('outstanding', 'gross').textContent(), /364,08/);
    assert.equal(await card.locator('.payment-tax-pending').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await card.locator('.payment-overview-totals').screenshot({ path: `${output}/reversed-compact-${width}.png` });
    // Partial mixed VAT is allocated to explicitly selected components, never proportionally.
    const mixed = await fixture({ totalRevenue: 337.5, taxAmount: 37.5, externalCosts: JSON.stringify(normalizeExternalCosts([
      { id: 'exempt', type: 'Outro', supplier: 'Parceiro isento QA', costAmount: 100, vatType: 'exempt' },
      { id: 'catering', type: 'Catering', supplier: 'Catering QA', costAmount: 100, vatType: 'catering' },
    ])) });
    await page.goto(`${base}/services/${mixed.id}?tab=costs`); await card.waitFor();
    await card.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const receive = page.getByRole('dialog', { name: 'Registar recebimento', exact: true });
    await receive.getByLabel('Valor sinalizado', { exact: true }).fill('150');
    await receive.getByLabel('Data da sinalização').fill('2026-10-16');
    await receive.getByLabel('Discriminar componentes pagos').check();
    await receive.getByLabel('Recebido em Staff', { exact: true }).fill('123');
    await receive.getByLabel('Recebido em Parceiro isento QA', { exact: true }).fill('27');
    await receive.screenshot({ path: `${output}/allocation-${width}.png` });
    await receive.getByRole('button', { name: 'Guardar pagamento', exact: true }).click(); await receive.waitFor({ state: 'detached' });
    assert.match(await card.locator('[data-payment-metric="received"] .payment-metric-base').textContent(), /127,00/);
    assert.match(await card.locator('[data-payment-metric="received"] .payment-metric-gross').textContent(), /150,00/);
    assert.match(await card.locator('[data-payment-metric="outstanding"] .payment-metric-gross').textContent(), /187,50/);
    await card.screenshot({ path: `${output}/mixed-${width}.png` });
    // Existing global reversal batches, matching the six historical receipts from the report.
    const historical = [], batches = [[690.52, 295.94], [100], [200, 1192.36], [123]];
    for (const [batch, amounts] of batches.entries()) {
      amounts.forEach((amount, index) => historical.push({ id: `old-${batch}-${index}`, type: index ? 'remaining' : 'signal', amount,
        receivedAt: index ? '2026-10-20' : '2026-10-16', recordedAt: '2026-10-16T12:00:00Z' }));
      historical.push({ id: `reversal-${batch}`, type: 'reversal', amount: -Math.round(amounts.reduce((sum, amount) => sum + amount, 0) * 100) / 100,
        recordedAt: '2026-10-16T13:00:00Z' });
    }
    const cleared = await fixture({ totalRevenue: 364.08, taxAmount: 68.08, clientPaymentRecord: JSON.stringify({ version: 1, entries: historical }) });
    await page.goto(`${base}/services/${cleared.id}?tab=costs`); await card.waitFor();
    await card.locator('.payment-overview-receipts > summary').click(); assert.equal(await rows.count(), 6);
    await rows.first().locator('.receipt-actions > summary').click(); await rows.first().getByRole('button', { name: 'Eliminar', exact: true }).click();
    await removeReversed.getByRole('button', { name: 'Cancelar', exact: true }).click(); assert.equal(await rows.count(), 6);
    await rows.first().locator('.receipt-actions > summary').click(); await rows.first().getByRole('button', { name: 'Eliminar', exact: true }).click();
    const countBefore = writes;
    await removeReversed.getByRole('button', { name: 'Eliminar recebimento', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await removeReversed.waitFor({ state: 'detached' }); assert.equal(writes, countBefore + 1);
    assert.equal(await rows.count(), 5);
    const afterClear = await db.event.findUnique({ where: { id: cleared.id } });
    const { clientPaymentRecord: _recordBefore, updatedAt: _beforeDate, ...originalFields } = cleared;
    const { clientPaymentRecord: _recordAfter, updatedAt: _afterDate, ...newFields } = afterClear;
    assert.deepEqual(newFields, originalFields);
    assert.deepEqual(readClientPaymentRecord(afterClear.clientPaymentRecord).entries.slice(0, -1), historical);
    await card.screenshot({ path: `${output}/reverted-deleted-${width}.png` });
    await page.reload(); await page.getByRole('button', { name: 'Custos', exact: true }).click(); await card.waitFor();
    await card.locator('.payment-overview-receipts > summary').click(); assert.equal(await rows.count(), 5);
    assert.match(await metric('received', 'gross').textContent(), /0,00/);
    assert.match(await metric('outstanding', 'gross').textContent(), /364,08/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await context.close(); console.log(`Independent edit/reverse/delete, audit, cash balance and selected mixed VAT passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); if (server) await new Promise((done) => server.close(done));
  await prisma?.$disconnect(); await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory);
}
