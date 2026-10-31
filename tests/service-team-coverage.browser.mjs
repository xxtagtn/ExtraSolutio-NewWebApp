// Simulated APIs only: never modifies real staffing, attendance or finances.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/service-team-coverage';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) {
    const event = { id: 41, name: 'JOGO - SLB - ALVERCA', status: 'drafting', statusMode: 'automatic',
      date: '2026-11-01', endDate: '2026-11-02', isContinuous: true, clientId: 1,
      client: { id: 1, name: 'SUPREME' }, externalCosts: [], workLocations: [], assignmentDrafts: [],
      requiredRoles: [
        { role: 'Emp.Mesa', day: '2026-11-01', qty: 1 },
        { role: 'Emp.Mesa', day: '2026-11-02', qty: 32 },
        { role: 'Chefe de Sala', day: '2026-11-02', qty: 1 },
      ], assignments: Array.from({ length: 34 }, (_, i) => ({
        id: i + 1, collaboratorId: i + 1, collaborator: { id: i + 1, name: `Pessoa QA ${i + 1}` },
        role: i === 33 ? 'Chefe de Sala' : 'Emp.Mesa', assignmentDate: i === 0 ? '2026-11-01' : '2026-11-02',
        status: i === 1 ? 'missed_justified' : i === 2 ? 'missed_unjustified' : 'confirmed',
        clientSynced: i > 2, hourlyRate: 8,
      })), totalRevenue: 0,
    };
    const errors = [], writes = [];
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'team-only-test', user: { id: 1, name: 'QA', role: 'admin' } })));
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (req.method() !== 'GET') {
        writes.push(url.pathname);
        if (url.pathname === '/api/services/41/workflow/synchronize') {
          event.status = 'team_complete';
          return route.fulfill({ json: event });
        }
        return route.fulfill({ status: 405, json: {} });
      }
      const emptyOrder = { mode: 'date', ids: [], version: 0 };
      const json = url.pathname === '/api/services' ? [event]
        : url.pathname === '/api/clients' ? [event.client]
          : url.pathname === '/api/auth/service-order' ? { active: emptyOrder, archive: emptyOrder }
            : url.pathname === '/api/notifications/attendance-attention' ? { items: [], inProgress: [], total: 0, summary: {} } : [];
      return route.fulfill({ json });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-31T12:00:00Z') });
    await page.goto(`${base}/dashboard`);
    const upcoming = page.locator('.command-panel--timeline').filter({ has: page.getByRole('heading', { name: 'Próximas 48h', exact: true }) });
    const serviceRow = upcoming.locator('.command-timeline-row').filter({ hasText: event.name });
    await serviceRow.getByText('Equipa completa', { exact: true }).waitFor();
    assert.equal(await page.getByText('Evento sem equipa completa', { exact: true }).count(), 0);
    await upcoming.screenshot({ path: `${output}/dashboard-${width}.png` });
    event.assignments[2].status = 'pending_confirmation';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await serviceRow.getByText('1 por confirmar', { exact: true }).waitFor();
    event.assignments[2].status = 'missed_unjustified';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await serviceRow.getByText('Equipa completa', { exact: true }).waitFor();
    await serviceRow.click(); await page.waitForURL('**/services/41');
    const team = page.locator('.service-detail-progress').filter({ has: page.getByText('Equipa', { exact: true }) });
    await team.getByText('34/34', { exact: true }).waitFor();
    assert.match(await team.getAttribute('class'), /--success/);
    await team.getByText('lugares preenchidos', { exact: true }).waitFor();
    const hours = page.locator('.service-detail-progress').filter({ has: page.getByText('Staff', { exact: true }) });
    await hours.getByText('0/32', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/service-${width}.png`, fullPage: true });
    await page.goto(`${base}/services`);
    const card = page.locator('.service-card').filter({ hasText: event.name });
    await card.getByText('Equipa: 34/34', { exact: true }).waitFor();
    assert.equal(await card.locator('[title="Confirmados: 32 · Faltas: 2"]').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(writes.every((path) => path === '/api/services/41/workflow/synchronize'), 'Only the existing operational-status synchronization may run');
    assert.deepEqual(errors, []);
    await context.close(); console.log(`Team coverage includes both absences while hours stay 0/32; dashboard refresh and list agree: ${width}px`);
  }
} finally { await browser.close(); }
