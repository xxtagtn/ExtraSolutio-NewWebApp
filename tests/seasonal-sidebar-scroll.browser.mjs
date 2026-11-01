// Simulated APIs only. Checks viewport anchoring without changing real settings.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/seasonal-sidebar-scroll';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const theme of ['halloween', 'christmas', 'easter']) for (const width of [320, 390, 1024, 1440, 1900]) {
    const height = width <= 900 ? 600 : width === 1024 ? 700 : 1000;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript((theme) => {
      localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'sidebar-scroll-test', user: { id: 1, name: 'QA', role: 'admin' } }));
      localStorage.setItem('extrasolutio.appearance.theme:1', theme);
    }, theme);
    const writes = [], errors = [];
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (req.method() !== 'GET') writes.push(url.pathname);
      const json = url.pathname === '/api/auth/appearance' ? { preference: theme, configured: true, controlsPublicQr: true, publicQrConfigured: true }
        : url.pathname === '/api/qr-codes/links' ? { items: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Colaborador ${i + 1}`, confirmedServices: 3 })),
          total: 25, page: 1, pageSize: 25, monthFrom: '2026-11-01' }
          : url.pathname === '/api/communication/tasks' ? { items: [], summary: {} } : [];
      return route.fulfill({ json });
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/communication`);
    await page.getByRole('button', { name: 'Links de picagem', exact: true }).click();
    await page.getByText('Colaborador 25', { exact: true }).waitFor();
    await page.waitForFunction((theme) => document.querySelector('.app-shell')?.dataset.seasonalTheme === theme, theme);
    const sidebar = page.locator('.sidebar'), scene = page.locator('.seasonal-sidebar-scene');
    if (width <= 900) {
      await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
      await page.waitForTimeout(250);
    }
    await scene.locator('.seasonal-art-tile').evaluate(async (el) => {
      const img = new Image(); img.src = getComputedStyle(el).backgroundImage.slice(5, -2); await img.decode();
    });
    const initial = await scene.boundingBox(), menu = await sidebar.boundingBox();
    assert.ok(Math.abs(initial.x) < 1 && Math.abs(initial.y + initial.height - height) < 1, 'Artwork starts in the bottom-left viewport corner');
    assert.ok(initial.width <= menu.width && initial.width >= menu.width - 2, 'Artwork stays inside the actual sidebar width');
    assert.equal(await scene.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
    if (width > 900) {
      for (const y of [300, 700, 100000]) {
        await page.evaluate((y) => window.scrollTo(0, y), y);
        await page.waitForTimeout(50);
        const current = await scene.boundingBox();
        assert.ok(Math.abs(current.y - initial.y) < 1 && Math.abs(current.x) < 1, 'Page scroll cannot move the artwork');
      }
    } else {
      await page.locator('.sidebar-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const current = await scene.boundingBox();
      assert.ok(Math.abs(current.y - initial.y) < 1, 'Scrolling the mobile menu cannot move its decoration');
      const content = await page.locator('.sidebar-content').boundingBox();
      assert.ok(content.y + content.height <= current.y, 'Mobile decoration has its own space, below menu text');
      const link = sidebar.getByRole('link', { name: 'Balancete', exact: true });
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height, 'Last navigation link remains reachable');
      assert.equal(await link.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, 'Artwork cannot intercept a navigation click');
    }
    const pixels = PNG.sync.read(await scene.screenshot({ path: `${output}/${theme}-${width}.png` }));
    let colored = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b] = pixels.data.subarray(i, i + 3);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35 && Math.max(r, g, b) > 90) colored++;
    }
    assert.ok(colored > 200, 'The actual decorative bitmap is nonblank');
    if (width <= 900) await sidebar.screenshot({ path: `${output}/menu-${theme}-${width}.png` });
    if (width > 900) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
      assert.equal(await scene.count(), 0, 'Collapsed navigation has no floating artwork');
    } else {
      await page.getByRole('button', { name: 'Fechar menu', exact: true }).first().click();
      await page.waitForTimeout(250);
      const closed = await scene.boundingBox();
      assert.ok(closed.x + closed.width <= 0, 'Closed mobile navigation does not leave the decoration on the page');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await context.close();
    console.log(`Sidebar decoration stays bottom-left, renders and leaves navigation usable: ${theme} ${width}px`);
  }
} finally { await browser.close(); }
