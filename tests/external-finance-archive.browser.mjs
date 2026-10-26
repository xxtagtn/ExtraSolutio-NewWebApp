// API calls are intercepted. Fixtures are kept in memory; no real payments are recorded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { synchronizeEventWorkflow } from '../server/services/eventWorkflow.js';
import { receiveAdditionalClientPayment, setClientCommercialStatus } from '../server/services/clientPayment.js';
import { updateClientFinancialMetadata } from '../server/services/clientFinancialMetadata.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/external-finance-archive';
await mkdir(output, { recursive: true });
const now = new Date('2026-10-13T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const client = { id: 1, name: 'Cliente QA', status: 'active', billingMethod: 'per_event', paymentTerm: 'days_15' };
const fixture = (id, patch = {}) => ({ id, name: `Parceiro QA ${id}`, clientId: 1, client,
  date: '2026-07-30', status: 'in_progress', statusMode: 'automatic', billingStatus: 'pending',
  requiredRoles: '[]', assignmentDrafts: null, assignments: [], workLocations: [], invoices: [],
  externalCosts: '[{"type":"Catering","supplier":"Parceiro QA","costAmount":1000,"marginPercent":20,"vatType":"standard_23"}]',
  totalCost: 1000, totalRevenue: 1476, taxAmount: 276, vatRateSnapshot: 23, billingAdjustment: 0,
  paidAmount: 0, notes: '[BUDGET_REF:ORC-QA-30-07]', updatedAt: new Date('2026-07-30'), ...patch });

try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'archive-qa',
    })), now.getTime());
    const page = await context.newPage();
    await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    const stored = [fixture(42), fixture(43, { date: '2026-12-20', billingStatus: 'paid', name: 'Parceiro futuro pago QA' })];
    const money = structuredClone(stored[0]);
    const writes = [];
    const database = { $transaction: async (callback) => callback({
      invoice: { findMany: async () => [] },
      event: {
        findUnique: async ({ where }) => structuredClone(stored.find((event) => event.id === where.id)),
        updateMany: async ({ where, data }) => {
          const event = stored.find((event) => event.id === where.id);
          assert.equal(event.assignments.length, 0);
          Object.assign(event, data);
          return { count: 1 };
        },
      },
    }) };
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      let body = [];
      if (path.endsWith('/client-finance')) {
        writes.push(request.postDataJSON().action);
        body = await updateClientFinancialMetadata(database, Number(path.split('/')[2]), request.postDataJSON(), { id: 1, name: 'QA' });
      } else if (path.endsWith('/client-payment/commercial-status')) {
        writes.push('invoiced');
        body = await setClientCommercialStatus(database, Number(path.split('/')[2]), request.postDataJSON(), { id: 1, name: 'QA' });
      } else if (path.endsWith('/client-payment/receive')) {
        writes.push('receive');
        body = await receiveAdditionalClientPayment(database, Number(path.split('/')[2]), request.postDataJSON());
      } else if (request.method() === 'PUT') {
        assert.match(path, /^\/services\/\d+$/);
        const id = Number(path.split('/').at(-1));
        const patch = request.postDataJSON();
        assert.deepEqual(Object.keys(patch).sort(), ['billingPaymentDate', 'billingStatus']);
        writes.push(patch.billingStatus);
        Object.assign(stored.find((event) => event.id === id), patch);
        body = await synchronizeEventWorkflow(database, id, { now });
      } else if (path === '/services') {
        body = [];
        for (const event of stored) body.push(await synchronizeEventWorkflow(database, event.id, { now }));
      } else if (/^\/services\/\d+$/.test(path)) {
        body = await synchronizeEventWorkflow(database, Number(path.split('/').at(-1)), { now });
      } else if (path === '/clients') body = [client];
      else if (path.endsWith('/workflow/synchronize')) {
        body = await synchronizeEventWorkflow(database, Number(path.split('/')[2]), { now });
      } else if (request.method() !== 'GET') throw new Error(`Unexpected write ${path}`);
      return route.fulfill({ json: body });
    });
    await page.goto(`${base}/finance?area=clients&eventId=42`);
    const summary = page.locator('.finance-client-summary-row').filter({ hasText: 'Cliente QA' });
    await summary.waitFor(); await summary.click();
    const eventRow = page.locator('.finance-client-event-row').filter({ hasText: 'Parceiro QA 42' });
    await eventRow.waitFor();
    await eventRow.getByText('A aguardar pagamento', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/pending-${width}.png`, fullPage: true });
    await eventRow.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Gerir recebimentos', exact: true });
    await manager.getByLabel('Estado financeiro', { exact: true }).selectOption('invoiced');
    assert.equal(await manager.getByLabel('Data de emissão da fatura', { exact: true }).inputValue(), '2026-07-31');
    await manager.getByRole('button', { name: 'Guardar faturação', exact: true }).click();
    await manager.locator('.client-billing-periods header').getByText('Faturado', { exact: true }).waitFor();
    assert.notEqual(stored[0].status, 'finalized');
    await manager.getByRole('button', { name: 'Registar recebimento', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Registar recebimento', exact: true });
    await editor.getByRole('button', { name: 'Guardar recebimento', exact: true }).click(); await manager.waitFor();
    assert.equal(await eventRow.count(), 1, 'A paid service stays in the financial workspace until confirmed');
    page.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Arquivar serviço', exact: true }).click();
    await manager.getByRole('button', { name: 'Restaurar serviço', exact: true }).click({ trial: true });
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.finance-client-event-row'));
    assert.equal(stored[0].status, 'finalized');
    assert.deepEqual(writes, ['invoiced', 'receive', 'archive']);
    for (const field of ['externalCosts', 'totalCost', 'totalRevenue', 'taxAmount', 'vatRateSnapshot', 'billingAdjustment', 'notes']) {
      assert.deepEqual(stored[0][field], money[field], field);
    }
    await page.goto(`${base}/finance?area=archive`);
    const archiveRow = page.locator('.finance-client-row').filter({ hasText: 'Cliente QA' });
    await archiveRow.waitFor(); await archiveRow.click();
    const archivedEvent = page.getByRole('button', { name: 'Parceiro QA 42', exact: true });
    await archivedEvent.waitFor();
    assert.equal(await page.getByText('Parceiro futuro pago QA', { exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/archive-${width}.png`, fullPage: true });
    await archivedEvent.click();
    await page.getByRole('heading', { name: 'Parceiro QA 42', exact: true }).waitFor();
    await page.getByText('Finalizado', { exact: true }).first().waitFor();
    await page.goto(`${base}/services`);
    await page.locator('.service-card').filter({ hasText: 'Parceiro futuro pago QA' }).waitFor();
    assert.equal(await page.locator('.service-card').filter({ hasText: 'Parceiro QA 42' }).count(), 0);
    await page.getByRole('button', { name: /^Arquivo/ }).click();
    await page.locator('.service-card').filter({ hasText: 'Parceiro QA 42' }).waitFor();
    assert.equal(await page.locator('.service-card').filter({ hasText: 'Parceiro futuro pago QA' }).count(), 0);
    await context.close();
    console.log(`Finance billing transitions, synchronized archives, future paid guard and consultation passed at ${width}px`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
