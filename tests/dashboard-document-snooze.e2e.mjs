import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5198';
const now = new Date('2026-11-10T11:00:00.000Z');
const browser = await chromium.launch({ channel: 'chrome' });

try {
  for (const width of [1440, 1170, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, timezoneId: 'Europe/Lisbon' });
    const collaborators = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Pessoa ${String(i + 1).padStart(2, '0')}`,
      documentType: 'cartao_cidadao', documentExpiry: '2026-11-01', status: 'active' }));
    const saved = new Map(), writes = [], errors = [];
    let rejectWrite = false;
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'snooze-qa',
      user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'snooze-qa' })), now.getTime());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (url.pathname === '/api/collaborators') return route.fulfill({ json: collaborators });
      if (url.pathname !== '/api/notifications/dashboard-documents') {
        assert.equal(request.method(), 'GET');
        return route.fulfill({ json: [] });
      }
      if (request.method() === 'GET') return route.fulfill({ json: [...saved].map(([key, snoozedUntil]) => ({ key, snoozedUntil })) });
      if (rejectWrite) return route.fulfill({ status: 503, json: { message: 'Teste: não foi possível guardar.' } });
      const body = request.postDataJSON();
      writes.push({ ...body, method: request.method() });
      assert.equal(request.method(), 'PUT');
      const snoozedUntil = body.until || new Date(now.getTime() + body.days * 86400000).toISOString();
      body.keys.forEach((key) => saved.set(key, snoozedUntil));
      return route.fulfill({ json: { snoozedUntil } });
    });

    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.goto(`${base}/dashboard`);
    const panel = page.locator('.command-actions-panel');
    const rows = panel.locator('.command-actions-row');
    const action = (i) => panel.getByRole('button', { name: `Adiar alerta de Pessoa ${String(i).padStart(2, '0')}`, exact: true });
    const dialog = page.getByRole('dialog');
    await panel.getByText('1–10 de 12 ações').waitFor();
    assert.equal(await rows.count(), 10);
    assert.equal(await panel.getByRole('button', { name: 'Página 1 de ações' }).getAttribute('aria-current'), 'page');
    assert.equal(await panel.getByRole('button', { name: /^(Pendentes|Adiados) \(/ }).count(), 0);
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    await panel.getByRole('button', { name: 'Página 2 de ações' }).click();
    await panel.getByText('11–12 de 12 ações').waitFor();
    assert.equal(await rows.count(), 2);
    await panel.getByRole('button', { name: 'Página anterior de ações' }).click();
    await action(1).click();
    assert.deepEqual(await dialog.getByLabel('Adiar por').locator('option').allTextContents(), ['1 dia', '7 dias', '30 dias', 'Escolher data e hora']);
    await dialog.getByLabel('Adiar por').selectOption('1');
    rejectWrite = true;
    await dialog.getByRole('button', { name: 'Adiar', exact: true }).click();
    await dialog.getByText('Teste: não foi possível guardar.').waitFor();
    assert.equal(saved.size, 0);
    rejectWrite = false;
    await dialog.getByRole('button', { name: 'Adiar', exact: true }).click();
    await panel.getByText('1–10 de 11 ações').waitFor();
    await panel.getByRole('status').getByText(/Alerta adiado até 11\/11\/2026/).waitFor();
    assert.equal(await action(1).count(), 0);
    await page.reload();
    await panel.getByText('1–10 de 11 ações').waitFor();
    assert.equal(await action(1).count(), 0);

    for (const i of [2, 3]) {
      await action(i).click();
      await dialog.getByLabel('Adiar por').selectOption('custom');
      if (i === 2) {
        await dialog.getByLabel('Data e hora', { exact: true }).fill('2026-11-09T11:02');
        await dialog.getByRole('button', { name: 'Adiar', exact: true }).click();
        await dialog.getByText('Escolhe uma data e hora futuras.').waitFor();
      }
      await dialog.getByLabel('Data e hora', { exact: true }).fill('2026-11-10T11:02');
      assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
      await dialog.getByRole('button', { name: 'Adiar', exact: true }).click();
      await action(i).waitFor({ state: 'detached' });
      assert.equal(writes.at(-1).until, '2026-11-10T11:02:00.000Z');
      assert.equal(writes.at(-1).keys.length, 1);
    }
    collaborators[2].documentExpiry = '2028-11-01';
    await page.clock.fastForward(121000);
    await action(2).waitFor();
    assert.equal(await action(3).count(), 0);
    assert.equal(await action(1).count(), 0);
    await page.getByRole('button', { name: 'Procurar', exact: true }).click();
    await page.getByPlaceholder('Procurar ação, cliente ou evento').fill('Pessoa 12');
    assert.equal(await rows.count(), 1);
    await action(12).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px: single list, numbered pagination, failed write, individual snooze, reload, expiry, renewed documents and search passed`);
  }
} finally { await browser.close(); }
