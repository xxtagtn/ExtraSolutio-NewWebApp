// Regression for retiring the former grouped QR tab. APIs are simulated only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 640, 900, 1440]) for (const restricted of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript((restricted) => {
      localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'tab-test', user: {
        id: 1, role: restricted ? 'operations' : 'admin', ...(restricted ? { permissions: ['communication.view'] } : {}),
      } }));
    }, restricted);
    const requests = [], errors = [];
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      requests.push(url.pathname);
      assert.equal(req.method(), 'GET', 'Switching tabs never creates links or punches');
      const json = url.pathname === '/api/qr-codes/links' ? { items: [{ id: 1, name: 'Ana Carolina Rodrigues' }], total: 1, page: 1, pageSize: 25 }
        : url.pathname === '/api/communication/tasks' ? { items: [], events: [], total: 0, summary: {} } : [];
      return route.fulfill({ json });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(`${base}/communication`);
    const nav = page.getByRole('navigation', { name: 'Áreas de comunicação' });
    await nav.getByRole('button', { name: 'Mensagens', exact: true }).waitFor();
    assert.equal(await nav.getByRole('button').count(), restricted ? 1 : 2);
    assert.equal(await page.getByRole('button', { name: /QR Codes|Ver QR|Imprimir|Download/ }).count(), 0);
    if (!restricted) {
      await nav.getByRole('button', { name: 'Links de picagem', exact: true }).click();
      await page.getByText('Ana Carolina Rodrigues', { exact: true }).waitFor();
      assert.equal(await page.locator('.attendance-links-table tbody tr').count(), 1);
      await page.clock.fastForward(15000);
      await nav.getByRole('button', { name: 'Mensagens', exact: true }).click();
    } else assert.equal(await nav.getByRole('button', { name: 'Links de picagem', exact: true }).count(), 0);
    assert.equal(requests.some((path) => path.startsWith('/api/qr-codes/events')), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Old QR tab removed, links permission preserved, no legacy polling: ${width}px ${restricted ? 'restricted' : 'admin'}`);
  }
} finally { await browser.close(); }
