import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.argv[3] || 'playwright');
const output = process.argv[2];
if (!output) throw new Error('Provide a screenshot output directory.');
await mkdir(output, { recursive: true });
const baseUrl = process.env.QR_UI_URL || 'http://localhost:5175';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let requests = 0;
try {
  for (const width of [1280, 390, 360, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/api/**', async (route) => {
      requests += 1;
      await route.fulfill({ status: 410, json: { message: 'Link mensal desativado' } });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/qr/month/already-issued-token`);
    await page.getByRole('heading', { name: 'Link mensal desativado' }).waitFor();
    await page.getByText('Pede o link diário do serviço à ExtraSolutio.').waitFor();
    assert.equal(await page.locator('.qr-check-command, .qr-month-history, .qr-consultation-record, .qr-summary-copy').count(), 0);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('.qr-check-card h1, .qr-check-card p')]
        .filter((element) => element.scrollWidth > element.clientWidth + 2).map((element) => element.textContent),
      logo: document.querySelector('.qr-check-logo img')?.naturalWidth > 0,
    }));
    assert.equal(layout.overflow, false);
    assert.deepEqual(layout.clipped, []);
    assert.equal(layout.logo, true);
    await page.screenshot({ path: join(output, `monthly-qr-disabled-${width}.png`), fullPage: true });
    await context.close();
  }
  assert.equal(requests, 0, 'Retired monthly links must not fetch private services');
  assert.deepEqual(errors, []);
  console.log('Retired monthly link UI passed at 320/360/390/1280px; no API requests, punches or history.');
} finally {
  await browser.close();
}
