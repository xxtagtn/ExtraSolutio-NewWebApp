// All API data is simulated; themes must never write to a financial endpoint.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/seasonal-theme';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], writes = [];
const demoNames = ['Joana Martins', 'Pedro Costa', 'Mariana Silva', 'Tiago Santos'];
const demoAttendance = demoNames.map((collaboratorName, index) => ({
  id: index + 1, assignmentId: index + 1, eventId: 10, eventName: 'Restaurante Luz - Serviço',
  collaboratorId: index + 1, collaboratorName, clientName: 'ExtraSolutio', role: 'Emp.Mesa',
  assignmentDate: '2026-10-29', startTime: '11:00', endTime: '20:00', checkIn: null, checkOut: null,
  kind: 'missing_entry', reason: 'Entrada por registar', to: '/services/10?tab=team&day=2026-10-29',
}));
const seed = () => {
  if (!localStorage.getItem('extrasolutio.auth')) localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'theme-test-only', user: { id: 1, name: 'Ana Rosa', role: 'admin', email: 'ana@example.test' },
  }));
};
async function mock(context) {
  const preferences = new Map();
  let controller = null;
  await context.addInitScript(seed);
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
    let json = [];
    if (url.pathname === '/api/auth/appearance') {
      const userId = request.headers().authorization?.includes('other-test-only') ? 2 : 1;
      if (request.method() === 'PUT') {
        const body = request.postDataJSON(); preferences.set(userId, body.preference);
        if (body.publishToQr && userId === 1) controller = userId;
      }
      return route.fulfill({ json: { preference: preferences.get(userId) || 'original', configured: preferences.has(userId),
        controlsPublicQr: controller === userId, publicQrConfigured: controller !== null, canPublishQr: userId === 1 } });
    }
    if (url.pathname === '/api/notifications/attendance-attention') json = {
      items: demoAttendance, inProgress: [], total: 4, summary: { missing_entry: 4 }, timeZone: 'Europe/Lisbon', checkedAt: '2026-10-29T12:00:00Z',
    };
    if (url.pathname === '/api/push/config') json = { enabled: false };
    return route.fulfill({ json });
  });
}
async function assertTheme(page, value) {
  try {
    await page.waitForFunction((expected) => document.querySelector('.app-shell')?.dataset.seasonalTheme === expected, value);
  } catch (error) {
    console.error('Theme assertion:', value, page.url(), await page.locator('body').innerText(), errors);
    await page.screenshot({ path: `${output}/failure.png` });
    throw error;
  }
}
async function fits(page, selector) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
  const clipped = await page.locator(selector).evaluateAll((elements) => elements.filter((el) =>
    el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  assert.deepEqual(clipped, [], 'Theme controls must not clip text');
}
async function artworkReady(page) {
  await page.locator('.seasonal-header-scene').evaluate(async (el) => {
    const img = new Image(); img.src = getComputedStyle(el).backgroundImage.slice(5, -2); await img.decode();
  });
}
try {
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1900]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'America/New_York' });
    await mock(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
    await page.goto(`${base}/profile`);
    await assertTheme(page, 'original');
    await page.getByLabel('Nome', { exact: true }).fill('Nome ainda por guardar');
    const financialColors = await page.locator('.app-shell').evaluate((el) => {
      const s = getComputedStyle(el);
      return ['--accent', '--danger', '--success', '--text', '--muted', '--bg'].map((p) => s.getPropertyValue(p));
    });
    const originalBorder = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).borderBottomColor);
    for (const [value, label] of [['halloween', 'Halloween'], ['christmas', 'Natal'], ['easter', 'Páscoa']]) {
      await page.getByRole('radio', { name: label, exact: true }).check();
      await assertTheme(page, value);
      await artworkReady(page);
      assert.equal(await page.getByLabel('Nome', { exact: true }).inputValue(), 'Nome ainda por guardar', 'Switching appearance preserves unsaved form fields');
      assert.equal(await page.evaluate(() => localStorage.getItem('extrasolutio.appearance.theme:1')), value);
      await fits(page, '.theme-choice, .theme-choice > span, .topbar-brand-title');
      const unchanged = await page.locator('.app-shell').evaluate((el) => {
        const s = getComputedStyle(el);
        return ['--accent', '--danger', '--success', '--text', '--muted', '--bg'].map((p) => s.getPropertyValue(p));
      });
      assert.deepEqual(unchanged, financialColors);
      assert.equal(await page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(11, 16, 19)', 'The header stays charcoal, not a full seasonal color band');
      assert.notEqual(await page.locator('.topbar').evaluate((el) => getComputedStyle(el).borderBottomColor), originalBorder);
      const decoration = page.locator('.seasonal-header-decoration');
      assert.equal(await decoration.getAttribute('aria-hidden'), 'true');
      assert.equal(await decoration.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
      assert.equal(await decoration.locator('.seasonal-header-scene').count(), 1);
      const headerBox = await page.locator('.topbar').boundingBox(), decorationBox = await decoration.boundingBox();
      assert.ok(decorationBox.y >= headerBox.y && decorationBox.y + decorationBox.height <= headerBox.y + headerBox.height, 'Corner decorations never spill onto data');
      assert.ok(headerBox.height >= 260, 'The expressive theme has a real scenic header, not a small corner motif');
      assert.ok((await decoration.locator('.seasonal-header-scene').boundingBox()).width >= 600);
      if (width > 1100) {
        const title = await page.locator('.topbar__left').boundingBox(), scene = await decoration.locator('.seasonal-header-scene').boundingBox();
        assert.ok(title.x + title.width <= scene.x, 'Desktop scene reserves clean negative space for the full wordmark');
      }
      assert.equal(await page.locator('.topbar-brand-title .seasonal-motif').count(), 0);
      await page.screenshot({ path: `${output}/profile-${value}-${width}.png` });
    }
    await page.getByRole('button', { name: 'Usar o meu tema nos links de picagem', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar aos links', exact: true }).click();
    await page.getByText('Tema das picagens: esta conta', { exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem('extrasolutio.appearance.theme:1', 'halloween'));
    await page.reload();
    await assertTheme(page, 'easter');
    assert.equal(await page.getByRole('radio', { name: 'Páscoa', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Abrir menu do perfil' }).click();
    await page.getByRole('menuitem', { name: /Aparência/ }).click();
    await page.getByRole('menuitemradio', { name: 'Halloween', exact: true }).click();
    await assertTheme(page, 'halloween');
    assert.equal(await page.getByRole('radio', { name: 'Halloween', exact: true }).isChecked(), true);
    await fits(page, '.theme-menu-option, .appearance-menu-toggle');
    const menu = await page.locator('.profile-menu').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1, 'Menu stays in the viewport');
    await page.screenshot({ path: `${output}/menu-${width}.png` });
    await page.getByRole('menuitemradio', { name: 'Halloween', exact: true }).press('ArrowDown');
    assert.equal(await page.getByRole('menuitemradio', { name: 'Natal', exact: true }).evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.profile-menu').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Abrir menu do perfil' }).evaluate((el) => el === document.activeElement), true);
    await page.getByRole('radio', { name: 'Automático', exact: true }).check();
    await assertTheme(page, 'halloween');
    await page.clock.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('extrasolutio.auth'));
      localStorage.setItem('extrasolutio.auth', JSON.stringify({ ...auth, lastActivityAt: Date.now() }));
      window.dispatchEvent(new Event('focus'));
    });
    await assertTheme(page, 'original');
    await page.clock.setSystemTime(new Date('2026-12-01T12:00:00Z'));
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('extrasolutio.auth'));
      localStorage.setItem('extrasolutio.auth', JSON.stringify({ ...auth, lastActivityAt: Date.now() }));
    });
    await page.clock.fastForward(60000);
    await assertTheme(page, 'christmas');
    await page.getByRole('radio', { name: 'Original', exact: true }).check();
    await assertTheme(page, 'original');
    assert.equal(await page.locator('.topbar-brand-title .seasonal-motif').count(), 0);
    assert.equal(await page.locator('.seasonal-header-decoration').count(), 0);
    // Cross-tab synchronization uses the same user key, without persisting anything server-side.
    const other = await context.newPage();
    await other.goto(`${base}/profile`);
    await other.getByRole('radio', { name: 'Natal', exact: true }).check();
    await assertTheme(page, 'christmas');
    await other.close();
    await page.goto(`${base}/dashboard`);
    await page.locator('.command-kpi').first().waitFor();
    await page.getByRole('region', { name: 'Picagens a precisar de atenção' }).getByText('Joana Martins', { exact: true }).waitFor();
    await assertTheme(page, 'christmas');
    await page.screenshot({ path: `${output}/dashboard-${width}.png` });
    await page.getByRole('button', { name: 'Abrir menu do perfil' }).click();
    await page.getByRole('menuitem', { name: /Aparência/ }).click();
    for (const [value, label] of [['halloween', 'Halloween'], ['christmas', 'Natal'], ['easter', 'Páscoa']]) {
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      await assertTheme(page, value);
      await artworkReady(page);
      await page.screenshot({ path: `${output}/dashboard-menu-${value}-${width}.png` });
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${output}/dashboard-${value}-${width}.png` });
      await page.locator('.topbar').screenshot({ path: `${output}/header-${value}-${width}.png` });
      await page.getByRole('button', { name: 'Abrir menu do perfil' }).click();
      await page.getByRole('menuitem', { name: /Aparência/ }).click();
    }
    const sprite = await page.locator('.seasonal-header-scene').evaluate(async (el) => {
      const url = getComputedStyle(el).backgroundImage.slice(5, -2);
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const cells = [];
      for (const [col, row, cellWidth] of [[0, 0, img.width], [0, 1, img.width / 4], [1, 1, img.width / 4], [2, 1, img.width / 4]]) {
        const data = ctx.getImageData(col * img.width / 4, row * img.height / 2, cellWidth, img.height / 2).data;
        let visible = 0, transparent = 0;
        for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) visible++; else transparent++; }
        cells.push({ visible, transparent });
      }
      return { width: img.width, height: img.height, cells };
    });
    assert.equal(sprite.width / sprite.height, 2);
    assert.ok(sprite.cells.every((cell) => cell.visible > 100 && cell.transparent > 100), 'Header, sidebar still life, garland and KPI corners contain real art and transparency');
    await page.getByRole('menuitemradio', { name: 'Natal', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Escolher tema', exact: true }).count(), 0, 'No theme selector beside the user');
    if (width > 900) {
      await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click();
      assert.equal(await page.locator('.seasonal-sidebar-scene').count(), 0, 'Collapsed navigation never contains large decorative art');
      await page.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click();
      assert.equal(await page.locator('.seasonal-sidebar-scene').count(), 1);
    } else {
      await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
      assert.equal(await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).position), 'fixed');
      await page.locator('.sidebar--open nav a').first().waitFor();
      await page.locator('.sidebar--open nav a').first().click({ trial: true });
      assert.equal(await page.locator('.sidebar--open nav a').first().evaluate((el) => {
        const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), true, 'Seasonal garlands do not intercept menu navigation');
      await page.screenshot({ path: `${output}/sidebar-${width}.png` });
      await page.locator('.sidebar').getByRole('button', { name: 'Fechar menu', exact: true }).click();
    }
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.seasonal-header-decoration').isVisible(), false);
    assert.equal(await page.locator('.seasonal-sidebar-scene').isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    // Another signed-in user on this browser starts with their own preference.
    await page.evaluate(async () => {
      const { setStoredAuth } = await import('/src/utils/authSession.js');
      setStoredAuth({ token: 'other-test-only', user: { id: 2, name: 'Outro Utilizador', role: 'viewer' } });
    });
    await assertTheme(page, 'original');
    await page.goto(`${base}/profile`);
    await page.getByRole('radio', { name: 'Páscoa', exact: true }).check();
    assert.equal(await page.evaluate(() => localStorage.getItem('extrasolutio.appearance.theme:1')), 'christmas');
    assert.equal(await page.evaluate(() => localStorage.getItem('extrasolutio.appearance.theme:2')), 'easter');
    await page.goto(`${base}/login`);
    assert.equal(await page.locator('[data-seasonal-theme]').count(), 0, 'Login remains unthemed');
    await context.close();
    console.log(`Themes, account isolation, storage, keyboard, calendar, unchanged semantic colors and print passed at ${width}px`);
  }
  // Storage restrictions keep themes usable in memory and give honest feedback.
  const restricted = await browser.newContext();
  await mock(restricted);
  await restricted.route('**/api/auth/appearance', (route) => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } })
    : route.fulfill({ json: { configured: false, preference: 'original', canPublishQr: true, publicQrConfigured: false, controlsPublicQr: false } }));
  await restricted.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('extrasolutio.appearance.theme:')) throw new Error('Storage unavailable');
      return setItem.call(this, key, value);
    };
  });
  const page = await restricted.newPage();
  await page.goto(`${base}/profile`);
  await page.getByRole('radio', { name: 'Natal', exact: true }).check();
  await assertTheme(page, 'christmas');
  await page.getByRole('status').filter({ hasText: 'apenas neste navegador' }).waitFor();
  await restricted.close();
  assert.ok(writes.some((write) => write === 'PUT /api/auth/appearance'), 'Appearance is persisted in the authenticated account');
  assert.deepEqual(writes.filter((write) => write !== 'PUT /api/auth/appearance'), [], 'Themes never write financial or operational data');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
