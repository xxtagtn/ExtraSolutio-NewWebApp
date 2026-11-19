// All requests use fixtures: no real event, assignment or budget is changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
const output = 'node_modules/.cache/service-list-loading';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-11-19T12:00:00Z');
const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event' };
const activeCount = Number(process.env.STRESS_ACTIVE || 9);
const archiveCount = Number(process.env.STRESS_ARCHIVE || 54);
const teamSize = Number(process.env.STRESS_TEAM_SIZE || 0);
assert.ok(Number.isInteger(activeCount) && activeCount > 0 && activeCount <= 1000);
assert.ok(Number.isInteger(archiveCount) && archiveCount >= 10 && archiveCount <= 10000);
assert.ok(Number.isInteger(teamSize) && teamSize >= 0 && teamSize <= 100);
const stress = activeCount !== 9 || archiveCount !== 54 || teamSize > 0;
const rows = Array.from({ length: activeCount + archiveCount }, (_, i) => ({ id: i + 1, name: `Evento QA ${i + 1}`,
  clientId: 1, client, status: i < activeCount ? (teamSize ? 'team_complete' : 'drafting') : 'finalized', statusMode: 'automatic',
  date: i < activeCount ? '2027-02-01' : '2026-10-01',
  requiredRoles: [{ role: 'Emp.Mesa', qty: teamSize || 32 }],
  assignments: Array.from({ length: teamSize }, (_, j) => ({ id: i * teamSize + j + 1,
    collaboratorId: j + 1, collaborator: { id: j + 1, name: `Colaborador QA ${j + 1}`, hourlyRate: 8 },
    role: 'Emp.Mesa', assignmentDate: i < activeCount ? '2027-02-01' : '2026-10-01',
    status: 'confirmed', isSynced: true, hourlyRate: 8,
    plannedCheckIn: '09:00', plannedCheckOut: '17:00', checkIn: i < activeCount ? null : '09:00',
    checkOut: i < activeCount ? null : '17:00', clientHourlyRate: 10.5,
    validationStatus: i < activeCount ? 'pending' : 'validated', paymentStatus: i < activeCount ? 'unpaid' : 'paid' })),
  externalCosts: '[]',
  totalCost: 0, totalRevenue: 0 }));
const payloadMiB = (Buffer.byteLength(JSON.stringify(rows)) / (1024 * 1024)).toFixed(2);
const defaultOrder = { mode: 'date', ids: [], version: 0 };
let lastPage;
const diagnostics = [];

try {
  const scenarios = stress ? [{ width: 1440 }, { width: 390 }]
    : [{ width: 1440 }, { width: 390 }, { width: 1440, transition: true }];
  for (const { width, transition } of scenarios) {
    const currentRows = structuredClone(rows);
    if (transition) currentRows[0].date = '2026-11-19';
    const expectedWrites = transition ? ['/api/services/1/workflow/synchronize'] : [];
    const context = await browser.newContext({ viewport: { width, height: 1000 },
      serviceWorkers: 'block', timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'loading-test', user: { id: 1, name: 'QA', role: 'admin' },
      sessionId: 'loading-test', lastActivityAt: timestamp,
    })), now.getTime());
    const reads = [], writes = [], errors = [];
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) {
        return url.origin === new URL(base).origin ? route.continue() : route.abort();
      }
      if (request.method() !== 'GET') {
        writes.push(url.pathname);
        if (url.pathname === '/api/services/1/workflow/synchronize') {
          assert.equal(request.postDataJSON().recalculateTotals, false);
          currentRows[0].status = 'in_progress';
          return route.fulfill({ json: currentRows[0] });
        }
      }
      else reads.push(url.pathname + url.search);
      return route.fulfill({ json: {
        '/api/services': currentRows, '/api/clients': [client],
        '/api/collaborators': [], '/api/collaborators/roles': ['Emp.Mesa'],
        '/api/service-templates': [], '/api/budgets': [],
        '/api/auth/service-order': { active: defaultOrder, archive: defaultOrder },
        '/api/notifications/overview': { notifications: { total: 1,
          allItems: [{ id: 'qa-alert', kind: 'followup', title: 'Aviso QA', subtitle: 'Resumo leve' }] },
        reminders: [{ id: 999, name: 'Pagamento QA' }] },
      }[url.pathname] || [] });
    });
    const page = await context.newPage();
    lastPage = page;
    page.setDefaultTimeout(60000);
    await page.clock.install({ time: now });
    page.on('pageerror', (error) => { errors.push(error.message); diagnostics.push(error.message); });
    const openedAt = performance.now();
    await page.goto(`${base}/services`);
    await page.getByRole('button', { name: `Ativos (${activeCount})`, exact: true }).waitFor();
    await page.getByRole('button', { name: `Arquivo (${archiveCount})`, exact: true }).waitFor();
    await page.waitForFunction((count) => document.querySelectorAll('.service-card').length === count, activeCount);
    const readyMs = Math.round(performance.now() - openedAt);
    assert.equal(await page.locator('.service-card').count(), activeCount);
    await page.waitForTimeout(150);
    if (transition) await page.locator('.service-card').filter({ hasText: 'Evento QA 1' })
      .getByText('Em execu\u00e7\u00e3o', { exact: true }).waitFor();
    assert.deepEqual(writes, expectedWrites, 'Only stale events may issue synchronization POSTs');
    assert.equal(reads.includes('/api/budgets'), false);
    assert.equal(reads.includes('/api/invoices'), false);
    assert.equal(reads.includes('/api/collaborators/roles'), false);
    assert.equal(reads.includes('/api/service-templates'), false);
    await page.getByRole('button', { name: 'Notifica\u00e7\u00f5es', exact: true }).click();
    await page.getByText('Aviso QA', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Notifica\u00e7\u00f5es', exact: true }).click();
    await page.getByText('Pagamento QA', { exact: true }).waitFor();
    const archivedAt = performance.now();
    await page.getByRole('button', { name: `Arquivo (${archiveCount})`, exact: true }).click();
    assert.equal(await page.locator('.service-card').count(), 10);
    const archiveMs = Math.round(performance.now() - archivedAt);
    await page.getByRole('button', { name: 'Seguinte', exact: true }).click();
    await page.getByText(`P\u00e1gina 2 de ${Math.ceil(archiveCount / 10)}`, { exact: true }).waitFor();
    const searchedAt = performance.now();
    await page.getByLabel('Pesquisar eventos e servi\u00e7os').fill(String(rows.length));
    await page.getByText(`Evento QA ${rows.length}`, { exact: true }).waitFor();
    const searchMs = Math.round(performance.now() - searchedAt);
    assert.equal(await page.locator('.service-card').count(), 1);
    const templateLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/service-templates');
    await page.getByRole('button', { name: /Novo Evento\/Servi/ }).click();
    await page.getByRole('dialog').waitFor();
    await templateLoaded;
    assert.ok(reads.includes('/api/collaborators/roles'));
    assert.ok(reads.includes('/api/service-templates'));
    assert.equal(reads.includes('/api/budgets'), false);
    assert.deepEqual(writes, expectedWrites);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    await context.close();
    console.log(JSON.stringify({ width, active: activeCount, archived: archiveCount,
      assignments: rows.length * teamSize, payloadMiB, readyMs, archiveMs, searchMs,
      requiredWrites: writes.length, result: 'PASS: lazy editor, notifications, archive pagination/search' }));
  }
  if (!stress) {
    const prepaidClient = { ...client, billingMethod: 'prepaid' };
    const paid = { ...structuredClone(rows[0]), requiredRoles: [], assignments: [],
      client: prepaidClient, notes: '[BUDGET_REF:ORC-42]', billingStatus: 'pending', eventType: 'Restaurante',
      startTime: '09:00', endTime: '17:00', location: 'Lisboa' };
    const budget = { id: 42, reference: 'ORC-42', paymentStatus: 'pending' };
    const writes = [], reads = [];
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'paid-budget-qa', user: { id: 1, role: 'admin', name: 'QA' },
      sessionId: 'paid-budget-qa', lastActivityAt: Date.now(),
    })));
    await context.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url()), key = url.pathname;
      if (!key.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() === 'GET') reads.push(key);
      else {
        writes.push(key);
        if (key === '/api/services/1') Object.assign(paid, request.postDataJSON());
        if (key === '/api/budgets/42') Object.assign(budget, request.postDataJSON());
      }
      return route.fulfill({ json: {
        '/api/services': [paid], '/api/services/1': paid, '/api/clients': [prepaidClient],
        '/api/budgets': [budget], '/api/budgets/42': budget,
        '/api/collaborators/roles': ['Emp.Mesa'],
        '/api/auth/service-order': { active: defaultOrder, archive: defaultOrder },
        '/api/notifications/overview': { notifications: { total: 0, allItems: [] }, reminders: [] },
      }[key] || [] });
    });
    lastPage = await context.newPage();
    await lastPage.goto(`${base}/services?serviceId=1`);
    const dialog = lastPage.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(reads.includes('/api/budgets'), false);
    await dialog.getByLabel('Estado do pagamento').selectOption('paid');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(reads.filter((key) => key === '/api/budgets').length, 1);
    assert.equal(budget.paymentStatus, 'paid');
    assert.deepEqual(writes, ['/api/services/1', '/api/budgets/42']);
    await context.close();
    console.log('PASS: paid service still updates its linked budget, fetched only at save time');
  }
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    console.error(lastPage.url(), (await lastPage.locator('body').innerText()).slice(0, 3000), diagnostics);
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
