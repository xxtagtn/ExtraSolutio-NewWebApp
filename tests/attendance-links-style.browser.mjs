// Visual reference regression; all APIs are simulated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/attendance-links-style';
await mkdir(output, { recursive: true });
const names = ['Ana Carolina Rodrigues', 'Alana Brandão Santos', 'Allef Vinicius Souza', 'Carla Alexandra Vitória', 'Karen Fernanda Santos'];
const counts = [8, 6, 5, 3, 4];
const items = names.map((name, index) => ({ id: index + 1, name, shortName: name.split(' ')[0], confirmedServices: counts[index] }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'style-test', user: { id: 1, name: 'QA', role: 'admin' } })));
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      assert.equal(req.method(), 'GET');
      const json = url.pathname === '/api/qr-codes/links' ? { items, total: 5, page: 1, pageSize: 25, totalPages: 1, monthFrom: '2026-11-01' }
        : url.pathname === '/api/communication/tasks' ? { items: [], summary: {} } : [];
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/communication`);
    await page.getByRole('button', { name: 'Links de picagem', exact: true }).click();
    const table = page.locator('.attendance-links-table');
    await table.getByText(names[4], { exact: true }).waitFor();
    assert.deepEqual(await table.getByRole('columnheader').allTextContents(), ['Nome', 'Serviços confirmados', 'Ação']);
    assert.equal(await table.locator('tbody tr').count(), 5);
    assert.equal(await page.getByRole('button', { name: /Ver QR|QR Codes|Imprimir|Download/ }).count(), 0);
    const style = await table.locator('tbody tr').first().evaluate((row) => ({
      height: row.getBoundingClientRect().height,
      background: getComputedStyle(row).backgroundColor,
      separator: getComputedStyle(row.children[1], '::after').width,
      separatorTop: getComputedStyle(row.children[1], '::after').top,
    }));
    assert.equal(style.background, 'rgb(13, 22, 26)');
    assert.equal(style.separator, '1px'); assert.equal(style.separatorTop, '10px');
    if (width > 1100) assert.ok(style.height >= 58 && style.height <= 62);
    const search = await page.locator('.attendance-links-search input').boundingBox();
    const icon = await page.locator('.attendance-links-search > svg').boundingBox();
    assert.ok(icon.x > search.x && icon.x + icon.width < search.x + search.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const row of await table.locator('tbody tr').all()) {
      const boxes = await row.locator('td').evaluateAll((cells) => cells.map((cell) => ({ left: cell.getBoundingClientRect().left, right: cell.getBoundingClientRect().right })));
      assert.ok(boxes.every((box) => box.left >= 0 && box.right <= width));
    }
    assert.deepEqual(errors, []);
    await page.locator('.attendance-links').screenshot({ path: `${output}/table-${width}.png` });
    await page.screenshot({ path: `${output}/page-${width}.png`, fullPage: true });
    await context.close();
    console.log(`Reference table style, short dividers, five rows and responsive layout: ${width}px`);
  }
} finally { await browser.close(); }
