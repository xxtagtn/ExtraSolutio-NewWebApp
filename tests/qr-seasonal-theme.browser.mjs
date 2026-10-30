// Public link responses are simulated; no real attendance is recorded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/qr-seasonal-theme';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 390, 1440]) for (const scope of ['single', 'day', 'month']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.appearance.theme:1', 'easter'));
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let theme = 'halloween', entered = false, completed = false, blocked = false;
    let collaboratorName = 'Joana Martins';
    const service = () => ({ assignmentId: 1, assignmentDate: '2026-10-29', eventName: 'Restaurante Luz Chakall',
      collaboratorName, clientName: 'SUPREME', role: 'Emp.Mesa', location: 'Estádio da Luz, Lisboa',
      startTime: '11:00', endTime: '16:00', plannedCheckIn: '11:00', plannedCheckOut: '16:00',
      checkIn: entered ? '10:58' : null, checkOut: completed ? '16:00' : null,
      state: { key: completed ? 'completed' : entered ? 'checked_in' : 'qr_generated',
        label: completed ? 'Concluído' : entered ? 'Em serviço' : 'Por registar', nextAction: entered ? 'check_out' : 'check_in' },
      checkOutRetryAfterMs: blocked ? 30000 : 0, checkOutAvailableTime: '11:28', completed });
    const payload = () => {
      const row = service(), daily = { collaboratorName, assignmentDate: row.assignmentDate,
        activeAssignmentId: completed ? null : 1, candidateIds: completed ? [] : [1], services: [row],
        completed, total: 1, completedCount: completed ? 1 : 0, revision: 'theme-test' };
      const data = scope === 'single' ? row : scope === 'day' ? daily : {
        collaboratorName: daily.collaboratorName, monthFrom: '2026-10-01', expiresAt: '2026-10-31T23:59:59Z', timeZone: 'Europe/Lisbon',
        activeDay: daily.assignmentDate, active: daily, services: [row],
      };
      return { ...data, appearance: { theme }, ...(completed ? { checkoutReceipt: { ...row, collaboratorName: 'Joana Martins' } } : {}) };
    };
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname.startsWith('/api/qr-check/')) {
        if (req.method() === 'POST') {
          writes.push(url.pathname);
          if (url.pathname.endsWith('/check-in')) entered = true;
          if (url.pathname.endsWith('/check-out')) completed = true;
        }
        return route.fulfill({ json: payload() });
      }
      return url.origin === new URL(base).origin ? route.continue() : route.abort();
    });
    const token = scope === 'month' ? 'month2.theme-qa-private' : 'theme-qa-private';
    const originalUrl = `${base}/qr/${scope === 'single' ? '' : `${scope}/`}${token}`;
    await page.goto(originalUrl);
    const root = page.locator('.qr-check-page');
    await page.waitForFunction(() => document.querySelector('.qr-check-page')?.dataset.seasonalTheme === 'halloween');
    const command = page.getByRole('button', { name: 'Dar Entrada', exact: true });
    await command.waitFor();
    const commandColor = await command.evaluate((el) => getComputedStyle(el).backgroundColor);
    for (const next of ['halloween', 'christmas', 'easter', 'original']) {
      theme = next;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction((value) => document.querySelector('.qr-check-page')?.dataset.seasonalTheme === value, next);
      assert.equal(page.url(), originalUrl, 'Already-shared URLs do not change with the theme');
      assert.equal(await command.evaluate((el) => getComputedStyle(el).backgroundColor), commandColor);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(writes.length, 0, 'Background theme updates must never punch');
      if (next !== 'original') {
        await page.locator('.seasonal-header-scene').evaluate(async (el) => { const img = new Image(); img.src = getComputedStyle(el).backgroundImage.slice(5, -2); await img.decode(); });
        const header = await page.locator('.qr-seasonal-header').boundingBox();
        const title = await page.locator('.qr-seasonal-identity-details h1').boundingBox();
        assert.ok(title.y >= header.y && title.y + title.height <= header.y + header.height, 'The title is integrated into the seasonal header');
        assert.equal(await page.locator('.qr-seasonal-banner').count(), 0, 'No separate decorative banner duplicates the header');
        assert.equal(await page.locator('.seasonal-header-decoration').evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
        const shade = await page.locator('.qr-seasonal-header').evaluate((el) => ({
          background: getComputedStyle(el, '::after').backgroundImage,
          pointerEvents: getComputedStyle(el, '::after').pointerEvents,
        }));
        assert.match(shade.background, /linear-gradient/, 'A dark shading layer separates the text from the artwork');
        assert.equal(shade.pointerEvents, 'none', 'The shading cannot block links or actions');
        const logo = page.locator('.qr-seasonal-identity > img');
        assert.equal(await logo.count(), 1);
        assert.equal(await logo.evaluate((el) => el.complete && el.naturalWidth > 0), true, 'The actual company logo renders');
        assert.ok(title.x + title.width <= header.x + header.width, 'The title fits the header');
        const footer = await page.locator('.qr-seasonal-footer').boundingBox();
        const footerArt = await page.locator('.qr-seasonal-footer .seasonal-art-tile').boundingBox();
        assert.ok(Math.abs(footerArt.x + footerArt.width / 2 - footer.x - footer.width / 2) < 1, 'Footer artwork is horizontally centered');
        assert.ok(footerArt.y >= footer.y && footerArt.y + footerArt.height <= footer.y + footer.height, 'Footer artwork is not clipped');
        if (next !== 'halloween') {
          assert.ok(footerArt.width / footerArt.height > 3, 'Christmas and Easter use the approved horizontal swag, not the old square illustration');
          const artwork = await page.locator('.seasonal-header-scene').evaluate((el) => getComputedStyle(el).backgroundImage);
          assert.ok(artwork.includes(next === 'christmas' ? 'christmas-decorations' : 'easter-garland'));
        }
        const button = await command.boundingBox();
        assert.ok(button.y + button.height <= 900, 'The primary punch action stays near the first mobile viewport');
        await page.screenshot({ path: `${output}/${scope}-${next}-${width}.png`, fullPage: true });
        await page.locator('.qr-seasonal-header').screenshot({ path: `${output}/${scope}-${next}-${width}-header.png` });
      } else assert.equal(await page.locator('.qr-seasonal-header').count(), 0);
    }
    theme = 'christmas';
    collaboratorName = 'Ana Carolina Rodrigues de Albuquerque e Vasconcelos';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('.qr-check-page')?.dataset.seasonalTheme === 'christmas');
    const identity = await page.locator('.qr-seasonal-identity-details').boundingBox();
    const longName = await page.locator('.qr-seasonal-identity-details h1').boundingBox();
    assert.ok(longName.x + longName.width <= identity.x + identity.width, 'Long names wrap within the identity area');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${scope}-long-name-${width}.png`, fullPage: true });
    blocked = true;
    await command.click();
    const exit = page.getByRole('button', { name: 'Dar Saída', exact: true });
    await exit.waitFor(); assert.equal(await exit.isDisabled(), true, 'The theme cannot bypass checkout cooldown');
    assert.equal(writes.length, 1);
    blocked = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await exit.click();
    await page.getByRole('status').filter({ hasText: 'Saída registada.' }).waitFor();
    const headerAfterCheckout = await page.locator('.qr-seasonal-header').boundingBox();
    const receipt = await page.locator('.qr-check-checkout-reminder').boundingBox();
    assert.ok(receipt.y >= headerAfterCheckout.y + headerAfterCheckout.height, 'The checkout receipt does not overlap the themed header');
    assert.equal(writes.length, 2);
    assert.equal(await root.getAttribute('data-seasonal-theme'), 'christmas');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Public themes update without auth, local preference leakage, new URLs or changed punch/cooldown: ${scope} ${width}px`);
  }
} finally { await browser.close(); }
