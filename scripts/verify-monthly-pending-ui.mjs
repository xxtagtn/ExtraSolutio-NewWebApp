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
let writes = 0;
const services = Array.from({ length: 25 }, (_, index) => ({
  assignmentId: index + 1, assignmentDate: `2026-10-${String(index + 2).padStart(2, '0')}`,
  eventName: index === 4 ? 'Residência do Embaixador da China' : `Evento confirmado ${index + 1}`,
  role: 'Emp. Mesa', location: 'Rua de Teste em Lisboa', workLocation: 'Sala principal',
  startTime: '08:00', endTime: '16:00', inProgress: false,
}));
const current = { assignmentId: 100, assignmentDate: '2026-10-01', eventName: 'Serviço atual',
  role: 'Bar', startTime: '09:00', endTime: '12:00', inProgress: true };
const active = {
  scope: 'day', assignmentDate: '2026-10-01', collaboratorName: 'Ana Cristina Rosa',
  total: 1, completedCount: 0, completed: false, revision: 'test-revision',
  activeAssignmentId: 100, candidateIds: [100], selectionRequired: false,
  punchRetryAfterMs: 0, switchRetryAfterMs: 0, services: [{ ...current, checkIn: '09:02', checkOut: '',
    state: { key: 'entrada_registada', label: 'Entrada registada', nextAction: 'check_out' },
    checkOutRetryAfterMs: 1800000, checkOutAvailableTime: '09:32' }],
};
const payload = { scope: 'month', monthFrom: '2026-10-01', collaboratorName: 'Ana Cristina Rosa',
  timeZone: 'Europe/Lisbon', expiresAt: '2026-10-31T23:59:59.999Z', activeDay: '2026-10-01',
  active, services: [current, ...services] };

async function layout(page, width) {
  const state = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    clipped: [...document.querySelectorAll('.qr-check-card h1, .qr-check-card h2, .qr-check-card p, .qr-check-card dd, .qr-check-card button, .qr-month-day summary')]
      .filter((element) => element.getBoundingClientRect().width && element.scrollWidth > element.clientWidth + 2)
      .map((element) => element.textContent),
    logo: document.querySelector('.qr-check-logo img')?.naturalWidth > 0,
  }));
  assert.equal(state.overflow, false, `${width}px page overflow`);
  assert.deepEqual(state.clipped, [], `${width}px clipped text`);
  assert.equal(state.logo, true);
}

try {
  for (const width of [1280, 390, 360, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    let response = payload;
    let status = 200;
    await context.route('**/api/**', async (route) => {
      if (route.request().method() !== 'GET') writes += 1;
      await route.fulfill({ status, json: response });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/qr/month/month2.ui-test`);
    await page.getByRole('heading', { name: 'Ana Cristina Rosa' }).waitFor();
    await page.getByRole('heading', { name: 'Próximos Serviços', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Próximos Serviços', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Dar Saída' }).isDisabled(), true);
    assert.equal(await page.locator('.qr-month-day').count(), 5);
    assert.equal(await page.locator('.qr-month-history .qr-check-command, .qr-summary-copy').count(), 0);
    assert.doesNotMatch(await page.locator('.qr-check-card').innerText(), /Horários realizados|Apenas consulta|Consulta até|Validação/);
    await page.locator('.qr-month-day summary').first().click();
    await page.locator('.qr-month-day[open] .qr-pending-service').waitFor();
    assert.match(await page.locator('.qr-month-day[open]').innerText(), /Horário previsto[\s\S]*08:00 → 16:00/);
    assert.doesNotMatch(await page.locator('.qr-month-day[open]').innerText(), /Entrada|Saída|Horas trabalhadas/);
    await layout(page, width);
    await page.screenshot({ path: join(output, `monthly-pending-${width}.png`), fullPage: true });
    await page.locator('.qr-month-day summary').nth(1).click();
    assert.equal(await page.locator('.qr-month-day[open]').count(), 1);
    const search = page.getByRole('searchbox', { name: 'Pesquisar evento ou dia' });
    await search.fill('residencia');
    assert.equal(await page.locator('.qr-month-day').count(), 1);
    await page.locator('.qr-month-day summary').click();
    assert.match(await page.locator('.qr-month-day[open]').innerText(), /Residência do Embaixador/);
    const refresh = async () => {
      const received = page.waitForResponse((result) => result.url().includes('/qr-check/month/'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await received;
    };
    await refresh();
    assert.equal(await search.inputValue(), 'residencia');
    assert.equal(await page.locator('.qr-month-day[open]').count(), 1);
    await search.fill('sem resultado');
    await page.getByText('Sem resultados para esta pesquisa.').waitFor();
    await page.getByRole('button', { name: 'Limpar pesquisa' }).click();
    for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: 'Página seguinte' }).click();
    await page.getByText('Página 5 de 5', { exact: true }).waitFor();
    response = { ...payload, active: null, activeDay: null, services: services.slice(0, 2) };
    await refresh();
    await page.waitForFunction(() => document.querySelectorAll('.qr-month-day').length === 2 && !document.querySelector('.qr-month-active'));
    assert.equal(await page.locator('.qr-check-command').count(), 0);
    await layout(page, width);
    response = { ...response, services: [] };
    await refresh();
    await page.getByText('Sem serviços pendentes neste mês.').waitFor();
    assert.equal(await page.locator('.qr-month-day').count(), 0);
    status = 410;
    response = { message: 'Este link mensal está expirado. Pede o link do mês atual.' };
    await refresh();
    await page.getByRole('heading', { name: 'Não foi possível validar' }).waitFor();
    assert.equal(await page.locator('.qr-check-command, .qr-month-day').count(), 0);
    await context.close();
  }
  assert.equal(writes, 0);
  assert.deepEqual(errors, []);
  console.log('Monthly pending UI passed: compact days, planned times only, current checkout, search, pagination, refresh, completion, expiry and layouts at 320/360/390/1280px.');
} finally {
  await browser.close();
}
