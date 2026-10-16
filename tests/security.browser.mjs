// All API calls are intercepted: no real accounts, photos or messages are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/security-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=', 'base64');
const user = { id: 1, name: 'Security QA', role: 'admin', email: 'qa@example.invalid' };
const collaborator = { id: 1, name: 'Pessoa QA', shortName: 'Pessoa QA', email: 'person@example.invalid', roles: ['Emp.Mesa'],
  status: 'active', photo: '/uploads/collaborators/qa.png', photoThumb: '/uploads/collaborators/thumbs/qa.png' };
const errors = [];
let lastPage;
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript((user) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'security-qa-old', user, sessionId: 'security-qa', lastActivityAt: Date.now(),
    })), user);
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', error => errors.push(error.message));
    let imageStatus = 200;
    const images = [], publicRequests = [], photoWrites = [];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path.startsWith('/uploads/')) { publicRequests.push(path); return route.abort(); }
      if (!path.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (path.startsWith('/api/uploads/')) {
        images.push({ path, authorization: request.headers().authorization });
        return route.fulfill({ status: imageStatus, contentType: 'image/png', body: imageStatus === 200 ? photo : Buffer.from('Forbidden') });
      }
      if (path === '/api/auth/password') return route.fulfill({ json: { message: 'Password alterada com sucesso.', token: 'security-qa-new', user } });
      if (path === '/api/probe') return route.fulfill({ json: { authorization: request.headers().authorization } });
      if (request.method() !== 'GET') photoWrites.push({ path, body: request.postData() });
      return route.fulfill({ json: path === '/api/collaborators' ? [collaborator]
        : path === '/api/collaborators/1' ? collaborator : path === '/api/collaborators/roles' ? ['Emp.Mesa']
          : path === '/api/notifications/overview' ? { notifications: { total: 0, items: [], allItems: [] }, reminders: [] }
            : path === '/api/collaborators/gender-summary' ? { total: 0 } : [] });
    });
    await page.goto(`${base}/collaborators?collaboratorId=1`);
    const image = page.getByAltText('Fotografia colaborador', { exact: true });
    await image.waitFor();
    await page.waitForFunction(() => [...document.images].some(img => img.alt === 'Fotografia colaborador' && img.naturalWidth > 0));
    assert.ok((await image.getAttribute('src')).startsWith('blob:'));
    await page.getByRole('button', { name: 'Ampliar fotografia do colaborador', exact: true }).click();
    const zoom = page.getByRole('dialog', { name: 'Fotografia - Pessoa QA', exact: true });
    await zoom.waitFor();
    await page.waitForFunction(() => [...document.images].some(img => img.alt === 'Fotografia de Pessoa QA' && img.naturalWidth > 0));
    await page.screenshot({ path: `${output}/photo-${width}.png` });
    await zoom.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    if (!await page.getByAltText('Foto de Pessoa QA', { exact: true }).isVisible()) {
      await page.locator('.collab-detail-card > header').click();
    }
    await page.waitForFunction(() => [...document.images].some(img => img.alt === 'Foto de Pessoa QA' && img.naturalWidth > 0));
    assert.ok(images.some(request => request.path.includes('/thumbs/')));
    assert.ok(images.every(request => request.authorization === 'Bearer security-qa-old'));
    assert.deepEqual(publicRequests, []); assert.deepEqual(photoWrites, []);

    await page.goto(`${base}/profile`);
    await page.getByLabel('Password atual', { exact: true }).fill('Old-Audit-2026!');
    await page.getByLabel('Nova password', { exact: true }).fill('New-Audit-2026!');
    await page.getByLabel('Confirmar nova password', { exact: true }).fill('New-Audit-2026!');
    await page.getByRole('button', { name: 'Alterar password', exact: true }).click();
    await page.getByText('Password alterada com sucesso.', { exact: true }).waitFor();
    const probe = await page.evaluate(async () => {
      const { api } = await import('/src/utils/api.js');
      return { result: await api('/probe'), stored: JSON.parse(localStorage.getItem('extrasolutio.auth')) };
    });
    assert.equal(probe.stored.token, 'security-qa-new');
    assert.equal(probe.result.authorization, 'Bearer security-qa-new');
    assert.deepEqual(probe.stored.user, user);
    assert.ok(page.url().endsWith('/profile'));

    imageStatus = 403;
    const denied = page.waitForResponse(response => response.url().includes('/api/uploads/'));
    await page.goto(`${base}/collaborators?collaboratorId=1`);
    await page.getByAltText('Fotografia colaborador', { exact: true }).waitFor();
    await denied;
    assert.equal(await page.getByAltText('Fotografia colaborador', { exact: true }).getAttribute('src'), null);
    assert.deepEqual(publicRequests, []);
    await context.close();
    console.log(`PASS ${width}px: private photo, thumbnail, zoom, no public fallback, password token renewal`);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    console.error('Browser state:', lastPage.url(), (await lastPage.locator('body').innerText()).slice(0,2500), errors);
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
