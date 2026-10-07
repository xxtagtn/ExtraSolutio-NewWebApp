// Read-only analysis; all API traffic uses in-memory fixtures, never production data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { money } from '../src/utils/formatters.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.TEST_BASE_URL || 'http://localhost:5175';
const output = 'node_modules/.cache/balance-staff';
await mkdir(output, { recursive: true });
const errors = [];
let writes = 0;
const client = { id: 1, name: 'Cliente QA' };
const otherClient = { id: 2, name: 'Outro Cliente' };
const assignment = (id, collaboratorId, name, assignmentDate, paymentStatus = 'unpaid', extra = {}) => ({
  id, collaboratorId, collaborator: { id: collaboratorId, name, shortName: name, nif: `300000${String(collaboratorId).padStart(3, '0')}` },
  role: 'Emp.Mesa', assignmentDate, paymentStatus, status: 'confirmed', hourlyRate: 10,
  validatedCheckIn: '08:00', validatedCheckOut: '13:00', validationStatus: 'validated', ...extra,
});
const services = [{ id: 1, name: 'Evento QA', client, clientId: 1, status: 'finalized', date: '2026-09-01', assignments: [
  assignment(1, 1, 'Miriam Peçanha Oliveira', '2026-09-01'),
  assignment(2, 1, 'Miriam Peçanha Oliveira', '2026-09-02', 'paid', { paymentDate: '2026-10-07' }),
  assignment(3, 1, 'Miriam Peçanha Oliveira', '2026-09-03'),
  assignment(4, 1, 'Miriam Peçanha Oliveira', '2026-10-01', 'paid'),
  assignment(5, 2, 'Ana Rosa', '2026-09-02', 'ganho', { advancePayments: '[{"amount":20},{"amount":40,"car":true}]' }),
  ...Array.from({ length: 25 }, (_, i) => assignment(i + 10, i + 10, `Colaborador ${i + 10}`, '2026-09-03', 'unpaid', { hourlyRate: 0.2 })),
  assignment(40, 1, 'Miriam Peçanha Oliveira', '2027-01-01'),
] }, { id: 2, name: 'Outro Evento', client: otherClient, clientId: 2, status: 'completed', date: '2026-09-02', assignments: [
  assignment(50, 3, 'Outro Colaborador', '2026-09-02', 'unpaid', { hourlyRate: 8 }),
] }, { id: 3, name: 'Por validar', client, clientId: 1, status: 'confirmed', date: '2026-09-01', assignments: [assignment(60, 4, 'Não validado', '2026-09-01')] }];

async function setup(width, { failServices = false, delay = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
  await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'test-only-token', user: { id: 1, name: 'Admin QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'balance-staff-qa',
  })));
  await context.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') writes++;
    const path = new URL(route.request().url()).pathname.slice(4);
    if (delay && path === '/services') await new Promise((resolve) => setTimeout(resolve, delay));
    if (failServices && path === '/services') return route.fulfill({ status: 500, json: { message: 'Serviços indisponíveis no teste' } });
    const body = { '/services': services, '/clients': [client, otherClient] }[path] || [];
    await route.fulfill({ status: 200, json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/balancete`);
  await page.locator('.balance-tabs').getByRole('button', { name: 'Staff', exact: true }).click();
  await page.getByLabel('Ano', { exact: true }).selectOption('2026');
  await page.getByLabel('Mês', { exact: true }).selectOption('9');
  return { page, context };
}

async function totals(page, amounts, annual) {
  await page.waitForFunction(({ amounts, annual }) => {
    const actual = [...document.querySelectorAll('.balance-staff-totals strong')].map((item) => item.textContent);
    return actual.join('|') === amounts.join('|') && document.querySelector('.balance-staff-annual strong')?.textContent === annual;
  }, { amounts: amounts.map((value) => money.format(value)), annual: money.format(annual) });
}

async function layout(page) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    clipped: [...document.querySelectorAll('.balance-staff button, .balance-staff strong, .balance-staff select, .balance-staff input, .balance-tabs button')]
      .filter((element) => element.checkVisibility() && element.scrollWidth > element.clientWidth + 2)
      .map((element) => element.textContent),
  }));
  assert.equal(result.overflow, false);
  assert.deepEqual(result.clipped, []);
}

try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const { page, context } = await setup(width);
    await totals(page, [305, 50, 235], 355);
    assert.equal(await page.locator('.balance-staff-costs tbody tr').count(), 10);
    await page.getByRole('button', { name: 'Página seguinte de Staff', exact: true }).click();
    assert.match(await page.locator('.balance-staff-pagination').innerText(), /11-20 de 28/);
    await page.getByLabel('Colaboradores por página').selectOption('all');
    assert.equal(await page.locator('.balance-staff-costs tbody tr').count(), 28);
    await page.getByLabel('Colaborador', { exact: true }).selectOption('1');
    await totals(page, [150, 50, 100], 200);
    assert.equal(await page.locator('.balance-staff-costs tbody tr').count(), 1);
    await page.locator('.balance-staff-months summary').click();
    assert.equal(await page.locator('.balance-staff-months tbody tr').count(), 12);
    assert.match(await page.locator('.balance-staff-months tbody tr').nth(8).innerText(), /150,00/);
    await page.getByLabel('Mês', { exact: true }).selectOption('10');
    await totals(page, [50, 50, 0], 200);
    assert.equal(await page.getByLabel('Colaborador', { exact: true }).inputValue(), '1');
    await page.getByLabel('Mês', { exact: true }).selectOption('');
    await totals(page, [200, 100, 100], 200);
    await page.getByLabel('Mês', { exact: true }).selectOption('9');
    await page.getByLabel('Colaborador', { exact: true }).selectOption('all');
    await page.getByLabel('Pesquisar colaborador').fill('pecanha');
    await totals(page, [150, 50, 100], 200);
    await page.getByLabel('Pesquisar colaborador').fill('300000002');
    await totals(page, [90, 0, 70], 90);
    await page.getByLabel('Pesquisar colaborador').fill('');
    await page.getByLabel('Cliente', { exact: true }).selectOption('2');
    await totals(page, [40, 0, 40], 40);
    await page.getByLabel('Cliente', { exact: true }).selectOption('all');
    await page.getByLabel('Estado', { exact: true }).selectOption('confirmed');
    await totals(page, [0, 0, 0], 0);
    assert.match(await page.locator('.balance-staff-costs').innerText(), /Sem custos/);
    await page.getByLabel('Estado', { exact: true }).selectOption('all');
    await page.getByLabel('Colaborador', { exact: true }).selectOption('1');
    await totals(page, [150, 50, 100], 200);
    await layout(page);
    assert.ok(await page.locator('.balance-staff-chart .recharts-bar-rectangle').count() > 0);
    assert.ok(await page.locator('.balance-staff-chart .recharts-bar-rectangle path').evaluateAll((bars) => bars.some((bar) => bar.getBoundingClientRect().height > 80)), 'Costs chart has visible, correctly scaled bars');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/staff-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.goto(`${base}/finance?area=staff&assignmentId=1`);
    await page.getByRole('heading', { name: 'Pagamentos de Staff', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Custos por Colaborador', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Evolução Mensal Staff', exact: true }).count(), 0);
    await context.close();
  }
  const refreshed = await setup(390);
  await totals(refreshed.page, [305, 50, 235], 355);
  services[0].assignments[0].paymentStatus = 'paid';
  await refreshed.page.reload();
  await refreshed.page.locator('.balance-tabs').getByRole('button', { name: 'Staff', exact: true }).click();
  await refreshed.page.getByLabel('Mês', { exact: true }).selectOption('9');
  await totals(refreshed.page, [305, 100, 185], 355);
  await refreshed.page.getByLabel('Ano', { exact: true }).selectOption('2027');
  await refreshed.page.getByLabel('Mês', { exact: true }).selectOption('1');
  await totals(refreshed.page, [50, 0, 50], 50);
  await refreshed.context.close();
  const failed = await setup(320, { failServices: true });
  await failed.page.getByText('Análise de Staff indisponível.', { exact: true }).waitFor();
  assert.equal(await failed.page.locator('.balance-staff-totals strong').first().textContent(), '—');
  await failed.context.close();
  const slow = await setup(390, { delay: 2500 });
  assert.equal(await slow.page.locator('.balance-staff').getAttribute('aria-busy'), 'true');
  await slow.page.waitForFunction(() => document.querySelector('.balance-staff')?.getAttribute('aria-busy') === 'false');
  await slow.context.close();
  assert.deepEqual(errors, []);
  assert.equal(writes, 0);
  console.log('Passed: Staff monthly/annual analysis, service dates, filters, search, pagination, refresh, states, empty/error/loading and 320-1440px layouts. No database writes.');
} finally {
  await browser.close();
}
