// No real services, staff or financial data are changed: all APIs are simulated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/service-slot-release';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) {
    const event = { id: 41, name: '38 lugares - regressão', status: 'drafting', statusMode: 'automatic', date: '2026-11-05', endDate: '2026-11-06',
      isContinuous: true, updatedAt: '2026-11-02T12:00:00Z', clientId: 1, client: { id: 1, name: 'SUPREME' },
      requiredRoles: [{ role: 'Emp.Mesa', qty: 38, agreedRate: 12, day: '2026-11-05' }],
      assignmentDrafts: [], externalCosts: [], workLocations: [], totalRevenue: 0,
      assignments: Array.from({ length: 38 }, (_, i) => ({ id: i + 1, collaboratorId: i + 1,
        collaborator: { id: i + 1, name: `Colaborador ${i + 1}` }, role: 'Emp.Mesa', assignmentDate: '2026-11-05',
        status: i === 37 ? 'cancelled' : 'confirmed', hourlyRate: 8, clientSynced: i < 37, updatedAt: '2026-11-02T12:00:00Z' })),
    };
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'slot-browser-test', user: { id: 1, name: 'QA', role: 'admin' } })));
    const errors = [], writes = [];
    let fail = false;
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (req.method() !== 'GET') {
        writes.push(url.pathname);
        if (url.pathname === '/api/services/41/assignments/38/slot') {
          if (fail) return route.fulfill({ status: 409, json: { message: 'Simulação de conflito: atualiza o evento.' } });
          const released = req.postDataJSON().released, row = event.assignments[37];
          assert.equal(row.status, 'cancelled');
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (released !== Boolean(row.slotRelease)) {
            row.slotRelease = released ? JSON.stringify({ version: 1, releasedAt: '2026-11-02T12:01:00Z', requirement: { ...event.requiredRoles[0] } }) : null;
            event.requiredRoles[0].qty += released ? -1 : 1;
          }
          event.status = released ? 'team_complete' : 'drafting';
          return route.fulfill({ json: event });
        }
        return route.fulfill({ status: 405, json: {} });
      }
      const json = url.pathname === '/api/services' ? [event] : url.pathname === '/api/services/41' ? event
        : url.pathname === '/api/clients' ? [event.client] : [];
      return route.fulfill({ json });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-02T12:00:00Z') });
    await page.goto(`${base}/services/41?tab=team`);
    const team = page.locator('.service-detail-progress').filter({ has: page.getByText('Equipa', { exact: true }) });
    await team.getByText('37/38', { exact: true }).waitFor();
    const actions = () => page.locator('.service-detail-team-row').last().getByRole('button', { name: 'Ações de Colaborador 38', exact: true });
    async function chooseAction(name) {
      await actions().click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    }
    const remove = () => chooseAction('Retirar lugar da equipa necessária');
    await actions().waitFor();
    await page.locator('.service-detail-team-row').last().screenshot({ path: `${output}/cancelled-${width}.png` });
    assert.equal(await page.locator('.service-detail-team-row').last().locator('.service-detail-row-actions button').count(), 1);
    await actions().click();
    const menu = page.getByRole('menu', { name: 'Ações de Colaborador 38', exact: true });
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1000);
    await page.screenshot({ path: `${output}/menu-${width}.png` });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menuitem', { name: 'Remover linha', exact: true }).evaluate((el) => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await actions().evaluate((el) => document.activeElement === el), true);
    await actions().click();
    await team.click();
    await menu.waitFor({ state: 'detached' });
    const firstRate = page.locator('input[placeholder="Ex: 8,50"]').first();
    await firstRate.fill('9'); await remove();
    await page.getByText('Guarda primeiro as alterações da equipa antes de retirar ou repor um lugar.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await firstRate.fill('8'); await remove();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.deepEqual(writes, []);
    await remove();
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Retirar lugar', exact: true });
    await confirm.evaluate((el) => { el.click(); el.click(); });
    await team.getByText('37/37', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(await page.locator('.service-detail-team-row').count(), 38, 'Historical cancelled row is kept');
    await page.getByText('Lugar retirado da necessidade', { exact: true }).waitFor();
    await page.locator('.service-detail-team-row').last().screenshot({ path: `${output}/released-${width}.png` });
    await team.screenshot({ path: `${output}/team-${width}.png` });
    await page.reload(); await team.getByText('37/37', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    await chooseAction('Repor lugar na equipa');
    await page.getByRole('dialog').getByRole('button', { name: 'Repor lugar', exact: true }).click();
    await team.getByText('37/38', { exact: true }).waitFor();
    assert.equal(event.assignments[37].status, 'cancelled', 'Restoring need never invents confirmation');
    fail = true; await remove();
    await page.getByRole('dialog').getByRole('button', { name: 'Retirar lugar', exact: true }).click();
    await page.getByRole('alert').getByText('Simulação de conflito: atualiza o evento.', { exact: true }).waitFor();
    assert.equal(event.requiredRoles[0].qty, 38);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Release/restore 38th slot, dirty-edit guard, double-click, persistence and failure: ${width}px`);
  }
} finally { await browser.close(); }
