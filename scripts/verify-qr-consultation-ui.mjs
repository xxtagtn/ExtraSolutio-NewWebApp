import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.argv[3] || 'playwright');
const output = process.argv[2];
if (!output) throw new Error('Provide a screenshot output directory.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const baseUrl = process.env.QR_UI_URL || 'http://localhost:5175';
const errors = [];
let writes = 0;
const active = {
  scope: 'day', assignmentDate: '2026-09-24', collaboratorName: 'Ana Cristina Rosa',
  total: 2, completedCount: 0, completed: false, revision: 'isolated-test',
  activeAssignmentId: 1, candidateIds: [1], selectionRequired: false,
  punchRetryAfterMs: 0, switchRetryAfterMs: 0,
  services: [{
    assignmentId: 1, eventName: 'Servico atual', role: 'Emp. Mesa', location: 'Lisboa',
    startTime: '08:00', endTime: '16:00', checkIn: '08:02', checkOut: '',
    state: { key: 'entrada_registada', label: 'Entrada registada', nextAction: 'check_out' },
    checkOutRetryAfterMs: 1800000, checkOutAvailableTime: '08:32',
  }],
};
const completed = { ...active, services: [], candidateIds: [], activeAssignmentId: null, completed: true, completedCount: 2 };
const preview = { ...completed, completed: false, completedCount: 0, punchRetryAfterMs: 3600000, punchAvailableTime: '00:00' };
const cases = [
  ['active', '/qr/day/ui-test', active, 200],
  ['completed', '/qr/day/ui-test', completed, 200],
  ['preview', '/qr/day/ui-test', preview, 200],
  ['expired-daily', '/qr/day/ui-test', { message: 'Este link diário está expirado.' }, 410],
  ['expired-legacy', '/qr/legacy-test', { message: 'Este QR Code está expirado.' }, 410],
];
try {
  for (const width of [1280, 390, 360, 320]) {
    for (const [name, path, initial, initialStatus] of cases) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      let body = initial;
      let status = initialStatus;
      await context.route('**/api/**', async (route) => {
        if (route.request().method() !== 'GET') writes += 1;
        await route.fulfill({ status, json: body });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseUrl}${path}`);
      if (status === 410) await page.getByRole('heading', { name: 'Não foi possível validar' }).waitFor();
      else await page.getByRole('heading', { name: active.collaboratorName }).waitFor();
      assert.equal(await page.locator('.qr-day-summary, .qr-month-history, .qr-consultation-record, .qr-summary-copy').count(), 0);
      if (name === 'active') {
        assert.equal(await page.getByRole('button', { name: 'Dar Saída' }).isDisabled(), true);
        assert.match(await page.locator('.qr-day-current').innerText(), /Servico atual/);
        assert.doesNotMatch(await page.locator('.qr-check-card').innerText(), /Validação|Validado|Por validar/);
      } else {
        assert.equal(await page.locator('.qr-check-command, .qr-day-current, input[type=radio]').count(), 0);
      }
      if (name === 'completed') await page.getByText('Todos os serviços deste dia estão concluídos.').waitFor();
      if (name === 'preview') await page.getByText('Picagens disponíveis em 24/09/2026, a partir das 00:00.').waitFor();
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll('.qr-check-card h1, .qr-check-card h2, .qr-check-card p, .qr-check-card dd, .qr-check-card button')]
          .filter((element) => element.scrollWidth > element.clientWidth + 2).map((element) => element.textContent),
        logo: document.querySelector('.qr-check-logo img')?.naturalWidth > 0,
      }));
      assert.equal(layout.overflow, false, `${name}: ${width}px`);
      assert.deepEqual(layout.clipped, [], `${name}: ${width}px`);
      assert.equal(layout.logo, true);
      await page.screenshot({ path: join(output, `daily-no-history-${name}-${width}.png`), fullPage: true });
      if (name === 'active') {
        body = { message: 'Este link diário está expirado.' };
        status = 410;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByRole('heading', { name: 'Não foi possível validar' }).waitFor();
        assert.equal(await page.locator('.qr-check-command, .qr-day-current').count(), 0);
      }
      await context.close();
    }
  }
  assert.equal(writes, 0);
  assert.deepEqual(errors, []);
  console.log('Daily and legacy no-history UI passed: current punch, preview metadata, completion, expiry and refresh at 320/360/390/1280px.');
} finally {
  await browser.close();
}
