// All APIs are simulated. No real event, financial record or attendance is modified.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/service-order';
await mkdir(output, { recursive: true });
const clients = [{ id: 1, name: 'SUPREME' }, { id: 2, name: 'Cliente B' }];
const events = Array.from({ length: 18 }, (_, index) => {
  const id = index + 1, archived = id > 5;
  return { id, name: `${id % 2 ? 'Grupo' : 'Outro'} - Serviço ${id}`, date: archived ? '2026-10-01' : `2026-11-0${6 - id}`,
    endDate: '2026-11-30', isContinuous: !archived, status: archived ? 'finalized' : 'drafting', statusMode: 'manual',
    clientId: id % 2 ? 1 : 2, client: clients[id % 2 ? 0 : 1], requiredRoles: '[{"role":"Emp.Mesa","qty":32}]',
    assignments: [], externalCosts: '[]', workLocations: [], totalRevenue: 947.1 };
});
const fresh = () => ({ active: { mode: 'date', ids: [], version: 0 }, archive: { mode: 'date', ids: [], version: 0 } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of process.env.TEST_WIDTH ? [Number(process.env.TEST_WIDTH)] : [320, 390, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'order-user-one', user: { id: 1, name: 'QA', role: 'admin' } })));
    const preferences = new Map([[1, fresh()], [2, fresh()]]), writes = [], errors = [];
    let failSave = false;
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const user = req.headers().authorization?.includes('user-two') ? 2 : 1;
      if (url.pathname.startsWith('/api/auth/service-order')) {
        if (req.method() === 'GET') return route.fulfill({ json: preferences.get(user) });
        writes.push({ path: url.pathname, body: req.postDataJSON() });
        if (failSave) return route.fulfill({ status: 503, json: { message: 'Falha simulada ao guardar ordem.' } });
        const scope = url.pathname.split('/').at(-1), body = req.postDataJSON();
        const state = preferences.get(user);
        if (body.version !== state[scope].version) return route.fulfill({ status: 409, json: { message: 'Conflito simulado.' } });
        state[scope] = { ...body, version: body.version + 1 };
        return route.fulfill({ json: state[scope] });
      }
      if (req.method() !== 'GET') { writes.push({ path: url.pathname }); return route.fulfill({ status: 405, json: {} }); }
      return route.fulfill({ json: url.pathname === '/api/services' ? events : url.pathname === '/api/clients' ? clients : [] });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/services`);
    const select = page.getByRole('combobox', { name: 'Ordenar eventos', exact: true });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Ordenar eventos"]')?.disabled);
    const ids = () => page.locator('.service-sortable-row').evaluateAll((rows) => rows.map((row) => Number(row.dataset.eventId)));
    const expectIds = async (expected) => {
      await page.waitForFunction((wanted) => JSON.stringify([...document.querySelectorAll('.service-sortable-row')].map((row) => Number(row.dataset.eventId))) === JSON.stringify(wanted), expected);
      assert.deepEqual(await ids(), expected);
    };
    const saved = () => page.waitForFunction(() => !document.querySelector('[aria-label="Ordenar eventos"]').disabled && document.querySelector('.service-order-save-status').textContent.includes('Ordem guardada'));
    await expectIds([1, 2, 3, 4, 5]);
    await select.selectOption('manual'); await saved();
    assert.equal(await page.locator('.service-drag-handle svg').first().getAttribute('width'), '14', 'Six dots stay visually small');
    const moveByMenu = async (id, command) => {
      const row = page.locator(`[data-event-id="${id}"]`);
      await row.locator('summary').click(); await row.getByRole('button', { name: command, exact: true }).click(); await saved();
    };
    await moveByMenu(3, 'Mover para o topo'); await expectIds([3, 1, 2, 4, 5]);
    await select.selectOption('date'); await saved(); await expectIds([1, 2, 3, 4, 5]);
    await select.selectOption('manual'); await saved(); await expectIds([3, 1, 2, 4, 5]);
    await page.reload(); await expectIds([3, 1, 2, 4, 5]);
    const handle = page.locator('[data-event-id="3"] .service-drag-handle');
    await handle.focus(); await page.keyboard.press('Space');
    await page.locator('.service-sortable-row--dragging').waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.keyboard.press('ArrowDown');
    try { await page.locator('[data-drop]').waitFor({ timeout: 3000 }); }
    catch (error) {
      await page.screenshot({ path: `${output}/keyboard-failure-${width}.png`, fullPage: true });
      console.log(await page.locator('.service-sortable-row').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.eventId, drop: row.dataset.drop, drag: row.className, rect: row.getBoundingClientRect().toJSON() }))));
      throw error;
    }
    await page.keyboard.press('Space');
    await saved(); await expectIds([1, 3, 2, 4, 5]);
    const beforeCancel = writes.length;
    await page.locator('[data-event-id="1"] .service-drag-handle').focus();
    await page.keyboard.press('Space'); await page.locator('.service-sortable-row--dragging').waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.keyboard.press('ArrowDown'); await page.locator('[data-drop]').waitFor(); await page.keyboard.press('Escape');
    await expectIds([1, 3, 2, 4, 5]); assert.equal(writes.length, beforeCancel, 'Escape never saves a drag');
    preferences.get(1).active = { mode: 'manual', ids: [2, 1, 3, 4, 5], version: preferences.get(1).active.version + 1 };
    await page.locator('[data-event-id="5"] summary').click();
    await page.locator('[data-event-id="5"]').getByRole('button', { name: 'Mover para o topo' }).click();
    await page.getByRole('alert').filter({ hasText: 'Conflito simulado' }).waitFor();
    await expectIds([2, 1, 3, 4, 5]);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Ordenar eventos"]').disabled);
    preferences.get(1).active = { mode: 'manual', ids: [1, 3, 2, 4, 5], version: preferences.get(1).active.version + 1 };
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expectIds([1, 3, 2, 4, 5]);
    await page.getByRole('searchbox', { name: 'Pesquisar eventos e serviços' }).fill('Grupo');
    await expectIds([1, 3, 5]); await moveByMenu(5, 'Mover para o topo'); await expectIds([5, 1, 3]);
    await page.getByRole('button', { name: 'Limpar pesquisa', exact: true }).click(); await expectIds([5, 1, 2, 4, 3]);
    const beforeFailure = await ids(); failSave = true;
    await page.locator('[data-event-id="3"] summary').click();
    await page.locator('[data-event-id="3"]').getByRole('button', { name: 'Mover para o topo' }).click();
    await page.getByRole('alert').filter({ hasText: 'Falha simulada' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Ordenar eventos"]').disabled);
    await expectIds(beforeFailure); assert.equal(await page.getByText('Ordem guardada', { exact: true }).count(), 0);
    failSave = false; await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await page.getByRole('button', { name: 'Arquivo (13)', exact: true }).click();
    await select.selectOption('manual'); await saved();
    const firstPage = await ids(); assert.equal(firstPage.length, 10);
    await moveByMenu(firstPage[3], 'Mover para o topo');
    assert.equal(preferences.get(1).archive.ids.length, 13, 'Saving a page preserves the complete archive order');
    await page.getByRole('button', { name: 'Seguinte', exact: true }).click(); assert.equal((await ids()).length, 3);
    await page.getByRole('button', { name: 'Ativos (5)', exact: true }).click(); await expectIds(beforeFailure);
    await page.evaluate(() => window.scrollTo(0, 0));
    const source = page.locator('[data-event-id="5"] .service-drag-handle');
    const target = page.locator('[data-event-id="1"] .service-drag-handle');
    await source.scrollIntoViewIfNeeded();
    const a = await source.boundingBox(), b = await target.boundingBox();
    if (width >= 1024) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
    } else {
      const cdp = await context.newCDPSession(page);
      const point = (y) => [{ x: a.x + a.width / 2, y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(a.y + a.height / 2) });
      await new Promise((done) => setTimeout(done, 300));
      for (let step = 1; step <= 12; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(a.y + a.height / 2 + (b.y + b.height / 2 - a.y - a.height / 2) * step / 12) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    }
    await saved(); await expectIds([1, 5, 2, 4, 3]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const overlaps = await page.locator('.service-card').evaluateAll((cards) => cards.some((card) => {
      const main = card.querySelector('.service-card__main').getBoundingClientRect(), meta = card.querySelector('.service-card__meta').getBoundingClientRect();
      return Math.min(main.right, meta.right) > Math.max(main.left, meta.left) + 1 && Math.min(main.bottom, meta.bottom) > Math.max(main.top, meta.top) + 1;
    }));
    assert.equal(overlaps, false, 'Dates and staff counters occupy separate space');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${output}/events-${width}.png`, fullPage: true });
    assert.ok(writes.every((write) => write.path.startsWith('/api/auth/service-order/')), 'No operational endpoint is written');
    await page.evaluate(async () => {
      const { setStoredAuth } = await import('/src/utils/authSession.js');
      setStoredAuth({ token: 'order-user-two', user: { id: 2, name: 'Other', role: 'admin' } });
    });
    await expectIds([1, 2, 3, 4, 5]); assert.equal(await select.inputValue(), 'date');
    assert.deepEqual(errors, []);
    await context.close(); console.log(`Personal order, filters, archive, reload, keyboard, cancel, failure, drag and account isolation passed: ${width}px`);
  }
} finally { await browser.close(); }
