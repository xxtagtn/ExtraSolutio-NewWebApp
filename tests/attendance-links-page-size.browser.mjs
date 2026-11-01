// Preferences persist in browser storage only. All API requests are simulated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      if (!localStorage.getItem('extrasolutio.auth')) localStorage.setItem('extrasolutio.auth', JSON.stringify({
        token: 'page-size-test', user: { id: 1, name: 'QA', role: 'admin' },
      }));
    });
    const queries = [], errors = [];
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      assert.equal(request.method(), 'GET', 'Page size changes do not mutate server data');
      if (url.pathname === '/api/qr-codes/links') {
        const page = Number(url.searchParams.get('page')), pageSize = Number(url.searchParams.get('pageSize'));
        queries.push({ page, pageSize });
        return route.fulfill({ json: { items: [{ id: 1, name: 'Ana Carolina Rodrigues', confirmedServices: 8 }],
          total: 120, totalPages: Math.ceil(120 / pageSize), page, pageSize, monthFrom: '2026-11-01' } });
      }
      return route.fulfill({ json: url.pathname === '/api/communication/tasks' ? { items: [], summary: {} } : [] });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    const openLinks = async () => {
      await page.getByRole('button', { name: 'Links de picagem', exact: true }).click();
      await page.getByText('Ana Carolina Rodrigues', { exact: true }).waitFor();
    };
    const size = () => page.locator('.attendance-links').getByRole('combobox', { name: 'Por página' });
    const waitQuery = (value) => page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/qr-codes/links' && url.searchParams.get('pageSize') === String(value);
    });
    await page.goto(`${base}/communication`); await openLinks();
    assert.equal(await size().inputValue(), '25');
    await page.getByRole('button', { name: 'Página seguinte', exact: true }).click();
    for (const value of [10, 50, 100, 25, 10]) {
      const changed = waitQuery(value);
      await size().selectOption(String(value)); await changed;
      assert.equal(queries.at(-1).page, 1, 'Changing the size resets the current page');
      await page.getByRole('button', { name: 'Mensagens', exact: true }).click();
      await openLinks(); assert.equal(await size().inputValue(), String(value));
      const before = queries.length;
      await page.reload(); await openLinks();
      assert.equal(await size().inputValue(), String(value));
      assert.ok(queries.slice(before).every((query) => query.pageSize === value), 'No temporary request with the default size on reload');
    }
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('extrasolutio.auth'));
      auth.user.id = 2; localStorage.setItem('extrasolutio.auth', JSON.stringify(auth));
    });
    await page.reload(); await openLinks(); assert.equal(await size().inputValue(), '25');
    const changed = waitQuery(50); await size().selectOption('50'); await changed;
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('extrasolutio.auth'));
      auth.user.id = 1; localStorage.setItem('extrasolutio.auth', JSON.stringify(auth));
    });
    await page.reload(); await openLinks(); assert.equal(await size().inputValue(), '10');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Page size persists through tabs and reloads, resets page and isolates accounts: ${width}px`);
  }
} finally { await browser.close(); }
