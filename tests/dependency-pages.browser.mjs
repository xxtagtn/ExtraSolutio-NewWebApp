// Mock every API request: this test never edits real services or financial data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
const output = 'node_modules/.cache/dependency-pages';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event' };
const event = { id: 41, name: 'Evento QA dependencias', client, clientId: 1,
  date: '2026-11-18', status: 'confirmed', statusMode: 'manual',
  assignments: [], requiredRoles: '[]', externalCosts: '[]', totalCost: 0, totalRevenue: 0 };

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 },
      serviceWorkers: 'block', timezoneId: 'Europe/Lisbon' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'dependency-pages-only', user: { id: 1, role: 'admin', name: 'QA' },
      sessionId: 'dependency-pages', lastActivityAt: Date.now(),
    })));
    const errors = [], writes = [];
    await context.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) {
        return url.origin === new URL(base).origin ? route.continue() : route.abort();
      }
      if (request.method() !== 'GET') writes.push(url.pathname);
      return route.fulfill({ json: {
        '/api/services': [event], '/api/clients': [client],
        '/api/notifications/overview': { notifications: { total: 0, items: [], allItems: [] }, reminders: [] },
      }[url.pathname] || [] });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/services`);
    await page.getByRole('button', { name: /Novo Evento\/Servi/ }).waitFor();
    await page.getByText(event.name, { exact: true }).waitFor();
    // Exercise SPA transitions without reloading React or replacing the document.
    await page.locator('a[href="/balancete"]').first().evaluate((link) => link.click());
    await page.locator('.balance-tabs').waitFor();
    await page.locator('.recharts-surface').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: `${output}/balancete-${width}.png` });
    await page.locator('a[href="/services"]').first().evaluate((link) => link.click());
    await page.getByText(event.name, { exact: true }).waitFor();
    await page.reload();
    await page.getByText(event.name, { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/services-${width}.png` });
    assert.deepEqual(errors, [], 'Both lazy pages must share the same React runtime');
    assert.deepEqual(writes, []);
    await context.close();
    console.log(`PASS ${width}px: Services -> Balancete/charts -> Services -> reload; no runtime errors or API writes`);
  }
} finally {
  await browser.close();
}
