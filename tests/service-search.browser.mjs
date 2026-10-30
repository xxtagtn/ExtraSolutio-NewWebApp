// Every API call is intercepted. No production records or workflow updates are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/service-search';
await mkdir(output, { recursive: true });
const now = new Date('2026-10-15T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const clients = [{ id: 1, name: 'Cliente A' }, { id: 2, name: 'Cliente B' }];
const fixture = (id, name, status, date = '2026-07-12', clientId = 1, patch = {}) => ({
  id, name, status, date, clientId, client: clients[clientId - 1], statusMode: 'manual',
  requiredRoles: '[]', assignments: [], workLocations: [], externalCosts: '[]', totalCost: 0, totalRevenue: 0, ...patch,
});
const events = [fixture(1, 'Casamento da Rita', 'drafting'), fixture(2, 'Rita - Batizado', 'in_progress', '2025-07-12', 2),
  fixture(3, 'Rita - Varios dias', 'team_complete', '2026-07-11', 1, { isContinuous: true, endDate: '2026-07-13' }),
  fixture(4, 'Jo\u00e3o - Corporate', 'to_validate_staff'), fixture(5, 'Outro evento', 'to_validate_client', undefined, 2),
  fixture(6, 'Rita - Outubro', 'drafting', '2026-10-12'), fixture(12, 'Evento ID direto', 'drafting'),
  fixture(112, 'Outro 112', 'in_progress', undefined, 2),
  fixture(13, 'Rita referencia', 'to_validate_client', undefined, 2, { serviceReference: 'EV-12' }),
  fixture(14, 'Rita 12', 'to_validate_staff', '2026-07-13', 2),
  ...Array.from({ length: 14 }, (_, index) => fixture(30 + index, `Rita Arquivo ${30 + index}`, 'finalized', index === 13 ? '2026-08-12' : '2026-07-12')),
  fixture(44, 'Rita Arquivo outro ano', 'finalized', '2025-07-12', 2), fixture(45, 'Alvo arquivo', 'finalized')];
const nameFor = (ids) => ids.map((id) => events.find((event) => event.id === id).name);
const errors = [];

try {
  for (const width of [320, 390, 768, 1024, 1201, 1280, 1366, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'qa', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'service-search-qa',
    })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const stored = structuredClone(events), before = structuredClone(stored), writes = [], reads = [];
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: {} }); }
      reads.push(url.pathname);
      if (url.pathname === '/api/auth/service-order') return route.fulfill({ json: Object.fromEntries(['active', 'archive']
        .map((scope) => [scope, { mode: 'manual', ids: stored.map((event) => event.id), version: 1 }])) });
      return route.fulfill({ json: url.pathname === '/api/services' ? stored : url.pathname === '/api/clients' ? clients : [] });
    });
    await page.goto(`${base}/services`);
    const input = page.getByRole('searchbox', { name: 'Pesquisar eventos e serviços' });
    await input.waitFor();
    assert.equal(await input.getAttribute('placeholder'), 'Pesquisar por evento, nome, data ou número...');
    const names = page.locator('.service-card__main > .service-card__field:first-child strong');
    async function expectIds(ids) {
      const expected = nameFor(ids);
      await page.waitForFunction((wanted) => JSON.stringify([...document.querySelectorAll('.service-card__main > .service-card__field:first-child strong')]
        .map((element) => element.textContent)) === JSON.stringify(wanted), expected);
      assert.deepEqual(await names.allTextContents(), expected);
    }
    await expectIds([1, 2, 3, 4, 5, 6, 12, 112, 13, 14]);
    const initialReadCount = reads.length;
    for (const [query, expected] of [
      ['Rita', [1, 2, 3, 6, 13, 14]], ['rita', [1, 2, 3, 6, 13, 14]], ['JOAO', [4]],
      ['12/07', [1, 2, 3, 4, 5, 12, 112, 13]], ['12/07/2026', [1, 3, 4, 5, 12, 112, 13]],
      ['Rita 12/07', [1, 2, 3, 13]], ['Casamento 12-07-2026', [1]], ['Rita 13/07', [3, 14]],
      ['12', [12, 13, 14]], ['EV-12', [13]], ['Rita 12', [13, 14]], ['31/02', []],
    ]) {
      await input.fill(query); await expectIds(expected);
      assert.equal(await page.getByText('A carregar...', { exact: true }).count(), 0);
    }
    await input.fill('Rita'); await expectIds([1, 2, 3, 6, 13, 14]);
    // A row that stays in the results is updated in place rather than remounted.
    await page.locator('.service-card').first().evaluate((element) => { window.qaFirstEvent = element; });
    await input.fill('Rita 12/07'); await expectIds([1, 2, 3, 13]);
    assert.equal(await page.locator('.service-card').first().evaluate((element) => element === window.qaFirstEvent), true);
    assert.equal(reads.length, initialReadCount, 'Typing does not query the API');
    await page.getByRole('combobox', { name: 'Filtrar por cliente' }).selectOption('1');
    await page.getByRole('combobox', { name: 'Filtrar por estado' }).selectOption('drafting');
    await page.getByLabel('Eventos a partir de').fill('2026-07-12');
    await expectIds([1]);
    await page.getByRole('button', { name: 'Limpar pesquisa', exact: true }).click();
    await expectIds([1, 6, 12]);
    assert.equal(await page.getByRole('combobox', { name: 'Filtrar por cliente' }).inputValue(), '1');
    assert.equal(await page.getByRole('combobox', { name: 'Filtrar por estado' }).inputValue(), 'drafting');
    assert.equal(await page.getByLabel('Eventos a partir de').inputValue(), '2026-07-12');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('combobox', { name: 'Filtrar por cliente' }).selectOption('');
    await page.getByLabel('Eventos a partir de').fill('');
    await input.fill('12/07/2026');
    for (const [status, expected] of [['drafting', [1, 12]], ['team_complete', [3]], ['in_progress', [112]],
      ['to_validate_staff', [4]], ['to_validate_client', [5, 13]], ['finalized', []]]) {
      await page.getByRole('combobox', { name: 'Filtrar por estado' }).selectOption(status); await expectIds(expected);
    }
    await input.fill('sem-resultados'); await expectIds([]);
    await page.getByText('Não foram encontrados eventos para esta pesquisa.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ativos (10)', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Arquivo (16)', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Arquivo (16)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Mês do arquivo' }).selectOption('7');
    await page.getByRole('combobox', { name: 'Ano do arquivo' }).selectOption('2026');
    await page.getByRole('combobox', { name: 'Filtrar por cliente' }).selectOption('1');
    await page.getByLabel('Eventos a partir de').fill('2026-07-12');
    await input.fill('Rita'); await expectIds(Array.from({ length: 10 }, (_, index) => 30 + index));
    await page.getByText('A mostrar 1-10 de 13', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Seguinte', exact: true }).click(); await expectIds([40, 41, 42]);
    await input.fill('Alvo'); await expectIds([45]);
    await page.getByText('A mostrar 1-1 de 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Limpar pesquisa', exact: true }).click();
    await expectIds(Array.from({ length: 10 }, (_, index) => 30 + index));
    await page.getByText('A mostrar 1-10 de 14', { exact: true }).waitFor();
    for (const [label, value] of [['Mês do arquivo', '7'], ['Ano do arquivo', '2026'], ['Filtrar por cliente', '1'], ['Filtrar por estado', 'finalized']]) {
      assert.equal(await page.getByRole('combobox', { name: label }).inputValue(), value);
    }
    await input.fill('Rita 12/07/2026');
    await expectIds(Array.from({ length: 10 }, (_, index) => 30 + index));
    for (const pageSize of ['20', '100', 'all']) {
      await page.getByRole('combobox', { name: 'Por página' }).selectOption(pageSize);
      await expectIds(Array.from({ length: 13 }, (_, index) => 30 + index));
    }
    await page.getByRole('combobox', { name: 'Por página' }).selectOption('10');
    await expectIds(Array.from({ length: 10 }, (_, index) => 30 + index));
    const filters = page.locator('.filters');
    if (width >= 1366) {
      const tops = await filters.locator('input, select').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, 'Desktop search and all archive filters share one row');
    }
    const separated = await input.evaluate((element) => {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
      const icon = element.parentElement.querySelector('svg').getBoundingClientRect();
      const clear = element.parentElement.querySelector('button').getBoundingClientRect();
      return bounds.left + parseFloat(style.paddingLeft) >= icon.right + 6
        && bounds.right - parseFloat(style.paddingRight) <= clear.left - 4;
    });
    assert.equal(separated, true, 'Search text must stay clear of both icons');
    await filters.screenshot({ path: `${output}/archive-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await filters.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
    const clipped = await filters.locator('input, select, button').evaluateAll((elements) => elements.filter((element) => {
      const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1;
    }).map((element) => element.tagName));
    assert.deepEqual(clipped, []);
    await page.getByRole('button', { name: 'Ativos (10)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Filtrar por estado' }).selectOption('');
    await expectIds([1, 3]);
    if (width >= 1366) {
      const tops = await filters.locator('input, select').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, 'Desktop search and active filters share one row');
    }
    await page.locator('.page').screenshot({ path: `${output}/active-${width}.png` });
    assert.deepEqual(stored, before); assert.deepEqual(writes, []);
    assert.equal(reads.length, initialReadCount);
    await context.close();
    console.log(`Search names/dates/IDs, all state/client/date/archive filters, pagination/reset, no extra API requests/writes and responsive layout passed at ${width}px.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
