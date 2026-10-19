// All API responses and writes are simulated; no application data is accessed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const output = 'node_modules/.cache/service-month-days';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [390, 1440]) {
    const collaborator = { id: 7, name: 'Ana Silva QA', roles: ['Emp.Mesa'], status: 'active', hourlyRate: 8 };
    const event = { id: 10, name: 'Servico outubro QA', date: '2026-10-01T00:00:00.000Z', endDate: '2026-10-31T00:00:00.000Z',
      isContinuous: true, status: 'confirmed', startTime: '10:00', endTime: '18:00',
      requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 12 }], assignments: [], assignmentDrafts: [],
      cancelledDays: ['2026-10-11', '2026-10-15', '2026-10-24'],
    };
    const writes = [];
    const errors = [];
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa-only',
      user: { id: 1, role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'month-days-qa' })));
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) {
        return url.origin === new URL(baseUrl).origin ? route.continue() : route.abort();
      }
      const path = url.pathname.slice(4);
      let body = [];
      if (request.method() !== 'GET') writes.push({ path, method: request.method(), body: request.postDataJSON() });
      if (path === '/assignments' && request.method() === 'POST') {
        body = { ...request.postDataJSON(), id: 100, collaborator };
        event.assignments.push(body);
      } else if (path === '/assignments/100' && request.method() === 'PUT') {
        Object.assign(event.assignments[0], request.postDataJSON());
        body = event.assignments[0];
      } else if (path === '/services/10' && request.method() === 'PUT') {
        Object.assign(event, request.postDataJSON());
        body = event;
      } else if (path === '/services/10') body = event;
      else if (path === '/services') body = [event];
      else if (path === '/collaborators') body = [collaborator];
      else if (path === '/collaborators/roles') body = ['Emp.Mesa'];
      else if (path === '/notifications/overview') body = { notifications: { total: 0, items: [], allItems: [] }, reminders: [] };
      return route.fulfill({ json: body });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}/services/10?tab=team`);
    const days = page.locator('.service-detail-day-tabs button');
    await days.last().waitFor();
    assert.equal(await days.count(), 31);
    assert.equal(await days.filter({ hasText: '31/10' }).count(), 1);
    assert.equal(await page.locator('.service-detail-day-tabs .service-tab--cancelled').count(), 3);
    await days.filter({ hasText: '31/10' }).click();
    assert.match(await page.locator('.service-detail-day-tabs .service-tab--active').innerText(), /31\/10/);
    await page.locator('.service-collab-trigger').first().click();
    await page.getByLabel('Pesquisar colaborador para alocar').fill('Ana');
    await page.locator('.service-collab-option').filter({ hasText: collaborator.name }).click();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/services/10') && response.request().method() === 'PUT'),
      page.getByRole('button', { name: 'Guardar alterações', exact: true }).last().click(),
    ]);
    assert.equal(event.assignments.length, 1);
    assert.equal(event.assignments[0].assignmentDate, '2026-10-31');
    assert.equal(Number(event.assignments[0].collaboratorId), collaborator.id);
    await page.reload();
    await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    await days.last().waitFor();
    assert.equal(await days.count(), 31);
    await days.filter({ hasText: '31/10' }).click();
    await page.locator('.service-collab-trigger').filter({ hasText: collaborator.name }).waitFor();
    assert.equal(writes.filter(write => write.path === '/assignments' && write.method === 'POST').length, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/october-${width}.png`, fullPage: true });
    await context.close();
    console.log(`31 days, cancelled days, last-day assignment and reload passed at ${width}px`);
  }
} finally {
  await browser.close();
}
