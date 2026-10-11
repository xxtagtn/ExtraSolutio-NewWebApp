// API requests are intercepted; no real picagens or messages are sent.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/qr-checkout-reminder';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

function payload(scope, phase) {
  const completed = phase === 'done';
  const service = {
    assignmentId: 1, eventName: 'Evento de Teste', clientName: 'Cliente de Teste', role: 'Emp.Mesa',
    startTime: '18:00', endTime: '04:00', plannedCheckIn: '18:00', plannedCheckOut: '04:00',
    checkIn: phase === 'entry' ? '' : '17:34', checkOut: completed ? '04:07' : '',
    state: { key: completed ? 'completed' : phase === 'entry' ? 'qr_generated' : 'checked_in',
      label: completed ? 'Concluido' : phase === 'entry' ? 'Por registar' : 'Entrada registada',
      nextAction: phase === 'entry' ? 'check_in' : 'check_out' },
    checkOutRetryAfterMs: 0,
  };
  const identity = { collaboratorName: 'Colaborador de Teste', assignmentDate: '2026-10-11' };
  if (scope === 'single') return { ...identity, ...service, completed };
  const daily = { ...identity, scope: 'day', completed, total: 1, completedCount: completed ? 1 : 0,
    activeAssignmentId: completed ? null : 1, candidateIds: completed ? [] : [1],
    services: completed ? [] : [service], revision: phase, switchRetryAfterMs: 0 };
  if (scope === 'day') return daily;
  return { scope: 'month', collaboratorName: identity.collaboratorName, monthFrom: '2026-10-01',
    expiresAt: '2026-10-31T23:59:59Z', timeZone: 'Europe/Lisbon',
    activeDay: completed ? null : identity.assignmentDate, active: completed ? null : daily,
    services: completed ? [] : [{ ...service, assignmentDate: identity.assignmentDate }] };
}

try {
  for (const width of [320, 390, 1440]) {
    for (const scope of ['single', 'day', 'month']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/New_York' });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      let phase = 'entry';
      let rejectExit = true;
      const posts = [];
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/qr-check/')) {
          return url.origin === new URL(base).origin ? route.continue() : route.abort();
        }
        if (request.method() === 'POST') {
          posts.push(url.pathname);
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (url.pathname.endsWith('/check-out') && rejectExit) {
            rejectExit = false;
            return route.fulfill({ status: 409, json: { message: 'Saida recusada no teste.' } });
          }
          phase = url.pathname.endsWith('/check-in') ? 'exit' : 'done';
        }
        const next = payload(scope, phase);
        if (request.method() === 'POST' && url.pathname.endsWith('/check-out')) {
          next.checkoutReceipt = { assignmentId: 1, collaboratorName: 'Colaborador de Teste',
            eventName: 'Evento de Teste', clientName: 'Cliente de Teste', role: 'Emp.Mesa',
            assignmentDate: '2026-10-11', plannedCheckIn: '18:00', plannedCheckOut: '04:00',
            checkIn: '17:34', checkOut: '04:07', location: 'Lisboa' };
        }
        return route.fulfill({ json: next });
      });
      const token = scope === 'month' ? 'month2.test-only' : 'test-only';
      await page.goto(`${base}/qr/${scope === 'single' ? '' : `${scope}/`}${token}`);
      const reminder = page.locator('.qr-check-checkout-reminder');
      const entry = page.getByRole('button', { name: 'Dar Entrada' });
      const exit = page.getByRole('button', { name: 'Dar Sa\u00edda', exact: true });
      await entry.waitFor();
      assert.equal(await reminder.count(), 0, 'No reminder on initial load');
      await entry.click();
      await exit.waitFor();
      assert.equal(await reminder.count(), 0, 'No reminder after entry');
      await exit.click();
      await page.getByText('Saida recusada no teste.').waitFor();
      await page.waitForFunction(() => !document.querySelector('.qr-check-command')?.disabled);
      assert.equal(await reminder.count(), 0, 'No success reminder after a failed exit');
      await exit.evaluate((button) => { button.click(); button.click(); });
      await reminder.waitFor();
      assert.match(await reminder.innerText(), /Aponta o teu hor\u00e1rio, ou tira print, este servi\u00e7o ser\u00e1 desativado de consulta muito em breve/);
      const summary = reminder.getByRole('region', { name: 'Servi\u00e7o acabado de concluir' });
      assert.match(await summary.innerText(), /Evento de Teste[\s\S]*11\/10\/2026/);
      assert.deepEqual(await summary.locator('dd').allTextContents(), ['17:34', '04:07']);
      assert.match(await summary.innerText(), /Hor\u00e1rio previsto: 18:00 \u2192 04:00/);
      assert.equal(posts.length, 3, 'One entry, one rejected exit and one successful exit despite double tap');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(150);
      assert.equal(await reminder.count(), 1, 'Refresh does not remove the reminder');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const clipped = await reminder.locator('p, button').evaluateAll((elements) =>
        elements.some((element) => element.scrollWidth > element.clientWidth + 1));
      assert.equal(clipped, false, 'Reminder text and close button fit');
      await page.screenshot({ path: `${output}/${scope}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Fechar aviso de sa\u00edda' }).click();
      assert.equal(await reminder.count(), 0);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(150);
      assert.equal(await reminder.count(), 0, 'Dismissed reminder is not recreated by refresh');
      await page.reload();
      await page.locator('.qr-check-completed').first().waitFor();
      assert.equal(await reminder.count(), 0, 'Old completed punches do not trigger a new reminder');
      assert.equal(posts.length, 3);
      assert.equal(await exit.count(), 0);
      await context.close();
      console.log(`Checkout-only reminder, failure, double tap, dismissal and layout passed: ${scope} ${width}px`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
