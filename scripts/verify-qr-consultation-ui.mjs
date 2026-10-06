import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.argv[3] || 'playwright');
const output = process.argv[2];
if (!output) throw new Error('Provide a screenshot output directory.');
await mkdir(output, { recursive: true });
const base = {
  assignmentDate: '2026-09-24', collaboratorName: 'Ana Cristina Rosa', timeZone: 'Europe/Lisbon',
  consultationExpiresAt: '2026-10-25T23:59:59.999Z', readOnly: true,
};
const morning = {
  assignmentId: 1, eventName: 'Embaixada da Republica Popular da China', clientName: 'Cliente de teste',
  role: 'Emp. Mesa', location: 'Lisboa', workLocation: 'Sala principal',
  startTime: '08:00', endTime: '16:00', plannedCheckIn: '08:00', plannedCheckOut: '16:00',
  checkIn: '08:02', checkOut: '16:05', validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '16:00',
  state: { key: 'completed', label: 'Concluido', nextAction: null }, expired: true, readOnly: true,
};
const afternoon = {
  ...morning, assignmentId: 2, eventName: 'Servico da tarde', role: 'Bar',
  checkIn: '17:00', checkOut: '', validationStatus: 'pending', validatedCheckIn: '', validatedCheckOut: '',
};
const daily = { ...base, scope: 'day', services: [morning, afternoon], total: 2, completedCount: 1,
  completed: false, candidateIds: [], selectionRequired: false, revision: 'isolated-ui' };
const individual = { ...base, ...morning, completed: true };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let mutations = 0;

async function setup(initial, path = '/qr/day/ui-test') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(() => Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text) => { window.copiedQrSummary = text; } },
  }));
  let response = initial;
  let status = 200;
  await context.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') mutations += 1;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.env.QR_UI_URL || 'http://localhost:5175'}${path}`);
  await page.locator('.qr-check-header').waitFor();
  return { context, page, update: (next, code = 200) => { response = next; status = code; } };
}

async function layout(page, width) {
  await page.setViewportSize({ width, height: 1000 });
  const result = await page.evaluate(() => {
    const problems = [];
    for (const element of document.querySelectorAll('.qr-check-card h1, .qr-check-card h2, .qr-check-card p, .qr-check-card dt, .qr-check-card dd, .qr-check-card button')) {
      const rect = element.getBoundingClientRect();
      if (rect.width && (rect.left < 0 || rect.right > innerWidth || element.scrollWidth > element.clientWidth + 2)) {
        problems.push(element.textContent);
      }
    }
    for (const row of document.querySelectorAll('.qr-consultation-record dl > div')) {
      const label = row.querySelector('dt').getBoundingClientRect();
      const value = row.querySelector('dd').getBoundingClientRect();
      if (label.right > value.left) problems.push(`Overlapping: ${row.textContent}`);
    }
    const logo = document.querySelector('.qr-check-logo img');
    return { problems, overflow: document.documentElement.scrollWidth > innerWidth, logo: logo.complete && logo.naturalWidth > 0 };
  });
  assert.deepEqual(result.problems, [], `${width}px: text overflow/overlap`);
  assert.equal(result.overflow, false, `${width}px: page overflow`);
  assert.equal(result.logo, true, 'Company logo loaded');
}

try {
  const { page, context, update } = await setup(daily);
  assert.equal(await page.locator('.qr-consultation-record').count(), 2);
  assert.equal(await page.locator('.qr-check-command, input[type=radio]').count(), 0);
  assert.match(await page.locator('.qr-consultation-record').first().innerText(), /08:02[\s\S]*16:05[\s\S]*8:03h[\s\S]*08:00 \u2192 16:00/);
  assert.match(await page.locator('.qr-consultation-record').last().innerText(), /Sem registo[\s\S]*Incompleto[\s\S]*Por validar/);
  for (const width of [1280, 390, 360, 320]) {
    await layout(page, width);
    await page.screenshot({ path: join(output, `qr-consultation-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Copiar resumo' }).click();
  const copied = await page.evaluate(() => window.copiedQrSummary);
  assert.match(copied, /Entrada registada: 08:02/);
  assert.match(copied, /Horario validado|Hor\u00e1rio validado/);
  assert.match(copied, /Servico da tarde/);
  assert.doesNotMatch(copied, /Validação:|Por validar/);
  await page.evaluate(() => { window.navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
  await page.getByRole('button', { name: 'Resumo copiado' }).click();
  const textarea = page.locator('.qr-summary-manual-copy textarea');
  await textarea.waitFor();
  assert.equal(await textarea.getAttribute('readonly'), '');
  assert.equal(await textarea.inputValue(), copied);
  await layout(page, 320);
  update({ message: 'O prazo de 31 dias para consultar os servicos deste dia terminou.' }, 410);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.qr-check-empty--error').waitFor();
  assert.equal(await page.locator('.qr-consultation-record, .qr-check-command').count(), 0);
  await context.close();

  const legacy = await setup(individual, '/qr/ui-test');
  assert.equal(await legacy.page.locator('.qr-consultation-record').count(), 1);
  for (const width of [1280, 390, 320]) await layout(legacy.page, width);
  await legacy.page.screenshot({ path: join(output, 'qr-consultation-individual.png'), fullPage: true });
  await legacy.context.close();

  const active = await setup({ ...individual, readOnly: false, completed: false, checkOut: '',
    checkOutRetryAfterMs: 1800000, checkOutAvailableTime: '08:32', state: { key: 'checked_in', label: 'Entrada registada', nextAction: 'check_out' } }, '/qr/ui-test');
  assert.equal(await active.page.locator('.qr-check-command').isDisabled(), true);
  assert.match(await active.page.locator('.qr-check-footnote').first().innerText(), /30 minutos/);
  active.update(individual);
  await active.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await active.page.locator('.qr-consultation-record').waitFor();
  assert.equal(await active.page.locator('.qr-check-command').count(), 0);
  await active.context.close();

  const preview = await setup({ ...daily, readOnly: false, services: [{ ...morning, readOnly: false, expired: false,
    checkIn: '', checkOut: '', state: { key: 'qr_generated', label: 'QR Gerado', nextAction: 'check_in' } }],
    total: 1, completedCount: 0, candidateIds: [1], activeAssignmentId: 1, punchRetryAfterMs: 86400000, punchAvailableTime: '00:00' });
  assert.equal(await preview.page.locator('.qr-check-command').isDisabled(), true);
  assert.match(await preview.page.locator('.qr-check-footnote').first().innerText(), /Picagens dispon/);
  await preview.context.close();
  assert.deepEqual(errors, []);
  assert.equal(mutations, 0, 'UI checks must never make a write request');
  console.log('QR consultation UI passed: daily/individual, 1280/390/360/320px, clipboard/fallback, expiry, live transition and punch cooldown/preview. No API writes.');
} finally {
  await browser.close();
}
