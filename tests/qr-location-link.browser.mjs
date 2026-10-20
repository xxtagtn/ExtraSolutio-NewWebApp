// Local UI with simulated QR and Maps responses; no real punches or Maps requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const output = 'node_modules/.cache/qr-location-link';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) for (const scope of ['single', 'day', 'month']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const location = 'Estádio da Luz, Avenida Eusébio da Silva Ferreira, 1500-313 Lisboa';
    const service = { assignmentId: 1, eventName: 'Restaurante Luz Chakall', role: 'Emp.Mesa', location,
      workLocation: 'Lounge A', state: { key: 'qr_generated', label: 'Por registar', nextAction: 'check_in' },
      startTime: '11:00', endTime: '18:00', assignmentDate: '2026-10-20' };
    const daily = { collaboratorName: 'Ana QA', assignmentDate: '2026-10-20', activeAssignmentId: 1,
      candidateIds: [1], services: [service], total: 1, completedCount: 0, revision: 'test' };
    const payload = scope === 'single' ? { ...daily, ...service }
      : scope === 'day' ? daily : { collaboratorName: 'Ana QA', monthFrom: '2026-10-01', expiresAt: '2026-10-31T23:59:59Z',
        timeZone: 'Europe/Lisbon', activeDay: daily.assignmentDate, active: daily,
        services: [service, { ...service, assignmentId: 2, assignmentDate: '2026-10-21', location: 'Rua João XXI, 1 & 2, Porto' },
          { ...service, assignmentId: 3, assignmentDate: '2026-10-21', location: '', workLocation: 'Sala interna' },
          { ...service, assignmentId: 4, assignmentDate: '2026-10-21', location: '', workLocation: '' }] };
    let writes = 0, mapsRequests = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'https://www.google.com') {
        mapsRequests++;
        assert.equal(url.searchParams.get('destination'), location);
        assert.equal(request.headers().referer, undefined, 'Never send the private QR URL to Maps');
        return route.fulfill({ contentType: 'text/html', body: '<p>Maps test destination</p>' });
      }
      if (url.pathname.startsWith('/api/qr-check/')) {
        if (request.method() !== 'GET') writes++;
        return route.fulfill({ json: payload });
      }
      return url.origin === new URL(base).origin ? route.continue() : route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const token = scope === 'month' ? 'month2.private-test-token' : 'private-test-token';
    const original = `${base}/qr/${scope === 'single' ? '' : `${scope}/`}${token}`;
    await page.goto(original);
    const link = page.getByRole('link', { name: `Abrir direções no Google Maps para ${location} (nova janela)`, exact: true });
    await link.waitFor();
    const url = new URL(await link.getAttribute('href'));
    assert.equal(url.searchParams.get('destination'), location);
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    await link.focus();
    const popupReady = page.waitForEvent('popup');
    await link.press('Enter');
    const popup = await popupReady;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(mapsRequests, 1);
    assert.equal(page.url(), original);
    assert.equal(writes, 0);
    await popup.close();
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).waitFor();
    if (scope === 'month') {
      await page.locator('.qr-month-day summary').first().click();
      assert.equal(await page.locator('.qr-month-history a.qr-location-link').count(), 1);
      assert.equal(new URL(await page.locator('.qr-month-history a.qr-location-link').getAttribute('href')).searchParams.get('destination'), 'Rua João XXI, 1 & 2, Porto');
      assert.equal(await page.locator('.qr-pending-service').filter({ hasText: 'Sala interna' }).getByRole('link').count(), 0);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.qr-location-link span').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth + 1)), false);
    await page.screenshot({ path: `${output}/${scope}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Maps destination, safe new tab, unchanged QR and responsive layout passed: ${scope} ${width}px`);
  }
} finally { await browser.close(); }
