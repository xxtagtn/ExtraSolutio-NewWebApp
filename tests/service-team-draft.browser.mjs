// All reads and writes are simulated. No real services or staff are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const output = 'node_modules/.cache/service-team-draft';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1440]) {
    const collaborators = Array.from({ length: 32 }, (_, i) => ({ id: i + 1, name: `Pessoa QA ${String(i + 1).padStart(2, '0')}`,
      roles: ['Emp.Mesa'], hourlyRate: 8, status: 'active' }));
    const service = { id: 10, name: 'Equipa 32 QA', date: '2026-10-20', isContinuous: false, status: 'confirmed',
      startTime: '10:00', endTime: '18:00', requiredRoles: [{ role: 'Emp.Mesa', qty: 32, agreedRate: 12 }],
      assignments: [], assignmentDrafts: [] };
    let reads = 0, posts = 0;
    const errors = [];
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'test-only',
      user: { id: 1, role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'team-qa' })));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      let body = [];
      if (path === '/services') {
        reads++;
        body = [{ ...service, clientFinance: { calculatedAt: `revision-${reads}` } }];
      } else if (path === '/services/10' && req.method() === 'PUT') {
        Object.assign(service, req.postDataJSON()); body = service;
      } else if (path === '/services/10') body = service;
      else if (path === '/assignments' && req.method() === 'POST') {
        const assignment = req.postDataJSON();
        body = { ...assignment, id: ++posts, collaborator: collaborators.find(c => c.id === assignment.collaboratorId) };
        service.assignments.push(body);
      } else if (path.startsWith('/assignments/') && req.method() === 'PUT') {
        body = service.assignments.find(a => a.id === Number(path.split('/').at(-1)));
        Object.assign(body, req.postDataJSON());
      } else if (path === '/collaborators') body = collaborators;
      else if (path === '/notifications/overview') body = { notifications: { total: 0, items: [], allItems: [] }, reminders: [] };
      return route.fulfill({ json: body });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/services/10?tab=team`);
    const rows = page.locator('.service-detail-team-row');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 32);
    const assertRow = async index => {
      const row = rows.nth(index);
      assert.match(await row.locator('.service-collab-trigger').innerText(), new RegExp(collaborators[index].name));
      assert.equal(await row.locator('select').last().inputValue(), 'confirmed');
      assert.equal(await row.locator('input[type="checkbox"]').isChecked(), true);
    };
    for (let i = 0; i < 32; i++) {
      const row = rows.nth(i);
      await row.locator('.service-collab-trigger').click();
      await page.getByLabel('Pesquisar colaborador para alocar').fill(collaborators[i].name);
      await page.locator('.service-collab-option').filter({ hasText: collaborators[i].name }).click();
      await row.locator('select').last().selectOption('confirmed');
      await row.locator('input[type="checkbox"]').check();
      if ([1, 2, 3, 15, 31].includes(i)) {
        const before = reads;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForResponse(response => new URL(response.url()).pathname === '/api/services');
        assert.ok(reads > before);
        await page.waitForTimeout(60);
        for (let done = 0; done <= i; done++) await assertRow(done);
      }
    }
    assert.equal(posts, 0, 'Confirm/sync edits remain drafts until explicit save');
    await page.getByRole('button', { name: 'Guardar alterações', exact: true }).last().click();
    await page.waitForFunction(() => document.querySelectorAll('.service-detail-team-row--empty').length === 0);
    assert.equal(posts, 32);
    assert.equal(service.assignments.length, 32);
    assert.ok(service.assignments.every(a => a.status === 'confirmed' && a.clientSynced));
    await page.getByRole('button', { name: 'Guardar alterações', exact: true }).last().click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('A guardar...')));
    assert.equal(posts, 32, 'A second save updates persisted IDs rather than duplicating staff');
    await page.reload();
    await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    await rows.first().waitFor();
    assert.equal(await rows.count(), 32);
    for (let i = 0; i < 32; i++) await assertRow(i);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${output}/saved-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`32 allocations, confirmation, sync, focus refreshes, save and reload passed at ${width}px`);
  }
} finally { await browser.close(); }
