// All API calls are intercepted. Only in-memory fixtures can be changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/external-service-workflow';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const now = new Date('2026-10-13T12:00:00Z');
const errors = [];

function fixture(patch = {}) {
  return { id: 42, name: 'Servico parceiro de 30/07', date: '2026-07-30', endDate: null, isContinuous: false,
    status: 'in_progress', statusMode: 'automatic', requiredRoles: '[]', assignmentDrafts: null, assignments: [],
    externalCosts: '[{"type":"Catering","supplier":"Parceiro QA","costAmount":1000,"marginPercent":20,"vatType":"standard_23"}]',
    totalCost: 1000, totalRevenue: 1476, taxAmount: 276, vatRateSnapshot: 23, billingAdjustment: 12.5,
    billingStatus: 'pending', paidAmount: 0, clientId: 1, client: { id: 1, name: 'Cliente QA', billingMethod: 'per_event' },
    invoices: [], workLocations: [], notes: '[BUDGET_REF:ORC-QA-30-07]', updatedAt: new Date('2026-07-30'), ...patch };
}

async function setup(width, patch = {}, permissions) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
  await context.addInitScript(({ permissions, timestamp }) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'test-only', user: { id: 1, name: 'QA', role: permissions ? 'operations' : 'admin', permissions },
    lastActivityAt: timestamp, sessionId: 'external-workflow-qa',
  })), { permissions, timestamp: now.getTime() });
  const page = await context.newPage();
  await page.clock.install({ time: now });
  page.on('pageerror', (error) => errors.push(error.message));
  const stored = fixture(patch);
  const posts = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    if (request.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/services' ? [stored] : [] });
    posts.push(url.pathname);
    return route.fulfill({ status: 405, json: { message: 'Unexpected write during consultation' } });
  });
  await page.goto(`${base}/services/42`);
  await page.getByRole('heading', { name: stored.name, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Marcar como realizado' }).count(), 0);
  assert.equal(await page.locator('.service-detail-external-complete').count(), 0);
  return { page, context, posts };
}

try {
  for (const width of [320, 390, 1440]) {
    for (const billingStatus of ['pending', 'invoiced', 'paid']) {
      const f = await setup(width, { billingStatus, status: billingStatus === 'paid' ? 'finalized' : 'in_progress' });
      const actions = f.page.locator('.service-detail-actions');
      assert.equal(await actions.getByRole('link', { name: 'Editar dados' }).count(), 1);
      assert.equal(await actions.getByRole('link', { name: 'Duplicar evento' }).count(), 1);
      assert.equal(await actions.getByRole('link', { name: 'Valida\u00e7\u00e3o de Horas' }).count(), 0);
      assert.match(await f.page.locator('.service-detail-checklist').innerText(), /Sem opera\u00e7\u00e3o de Staff/);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (billingStatus === 'pending') await f.page.screenshot({ path: `${output}/no-manual-action-${width}.png`, fullPage: true });
      assert.deepEqual(f.posts, []);
      await f.context.close();
    }
    console.log(`Manual completion button absent, existing actions and layout preserved at ${width}px`);
  }
  for (const patch of [
    { requiredRoles: '[{"role":"Emp.Mesa","qty":4}]' },
    { assignments: [{ collaboratorId: 1, role: 'Bar', status: 'confirmed', collaborator: { name: 'Staff QA' } }] },
    { requiredRoles: '[{"role":"Bar","qty":2}]', externalCosts: fixture().externalCosts },
    { externalCosts: '[]' },
  ]) {
    const f = await setup(390, patch);
    assert.equal(await f.page.getByRole('button', { name: 'Marcar como realizado' }).count(), 0);
    assert.equal(await f.page.locator('.service-detail-actions').getByRole('link', { name: 'Valida\u00e7\u00e3o de Horas' }).count(), 1);
    assert.equal(f.posts.length, 0);
    await f.context.close();
  }
  const future = await setup(390, { date: '2030-07-30', billingStatus: 'paid', paidAmount: 1476 });
  assert.equal(future.posts.length, 0);
  await future.context.close();
  const noEdit = await setup(390, {}, ['services.view']);
  assert.equal(await noEdit.page.getByRole('button', { name: 'Marcar como realizado' }).count(), 0);
  await noEdit.context.close();
  assert.deepEqual(errors, []);
  console.log('Staff/mixed validation links, future paid and read-only consultation passed; no real data touched.');
} finally {
  await browser.close();
}
