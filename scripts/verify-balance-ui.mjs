import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.argv[3] || 'playwright');

const output = process.argv[2];
if (!output) throw new Error('Provide a screenshot output directory.');
await mkdir(output, { recursive: true });
const client = { id: 1, name: 'FIC Restaurante', paymentTerm: 'days_30' };
const otherClient = { id: 2, name: 'Outro cliente', paymentTerm: 'days_30' };
const services = [
  { id: 1, name: 'FIC Restaurante - FIXOS', date: '2026-10-01', status: 'finalized',
    totalRevenue: 4064.6, totalCost: 3124.5, taxAmount: 1,
    externalCosts: [{ type: 'Parceiro', costAmount: 385, marginPercent: 0, vatType: 'exempt' }], clientId: 1, client,
    assignments: [{ id: 1, collaboratorId: 1, collaborator: { name: 'Miriam Peçanha Oliveira' }, status: 'confirmed', totalPay: 1300, paymentStatus: 'unpaid' }] },
  ...[5, 6, 7, 8, 9].map((month) => ({ id: month, name: `Serviço ${month}`, date: `2026-${String(month).padStart(2, '0')}-01`,
    status: 'finalized', totalRevenue: month === 9 ? 3890 : month * 200, totalCost: month === 9 ? 2650 : month * 150, clientId: 1, client })),
  { id: 20, name: 'Serviço por faturar', date: '2026-10-03', status: 'finalized', totalRevenue: 864.6, totalCost: 400, clientId: 1, client },
  { id: 21, name: 'Evento confirmado', date: '2026-10-25', status: 'confirmed', totalRevenue: 7820, totalCost: 1000, clientId: 1, client },
  { id: 22, name: 'Evento de outro cliente', date: '2026-10-26', status: 'team_complete', totalRevenue: 1000, totalCost: 400, clientId: 2, client: otherClient },
];
const invoices = [
  { id: 1, number: 'FT 2026/1', eventId: 1, clientId: 1, issueDate: '2026-08-01', status: 'issued', total: 750, client },
  { id: 2, number: 'FT 2026/2', eventId: 1, clientId: 1, issueDate: '2026-10-01', status: 'issued', total: 1400, client },
];
const budgets = [{ id: 1, reference: 'ORC 2026/1', eventDate: '2026-10-28', totalAmount: 3400, status: 'sent', clientId: 1, client }];
const responses = { '/services': services, '/clients': [client, otherClient], '/invoices': invoices, '/transactions': [], '/budgets': budgets };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let mutations = 0;

async function setup({ invoiceError = false, delay = 0, restricted = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1040 } });
  await context.addInitScript(({ restricted }) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'isolated-visual-test', user: restricted ? { id: 1, name: 'Consulta financeira', role: 'finance', permissionOverrides: { deny: ['budgets.view'] } }
      : { id: 1, name: 'Teste visual', role: 'admin' }, sessionId: 'isolated-ui-test', lastActivityAt: Date.now(),
  })), { restricted });
  await context.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') mutations += 1;
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    if (delay && ['/services', '/clients', '/invoices'].includes(path)) await new Promise((resolve) => setTimeout(resolve, delay));
    if (invoiceError && path === '/invoices') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Faturas indisponíveis no teste' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[path] || []) });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.env.BALANCE_UI_URL || 'http://localhost:5175'}/balancete`);
  return { context, page };
}

async function selectPeriod(page) {
  await page.getByLabel('Mês', { exact: true }).selectOption('10');
  await page.getByLabel('Ano', { exact: true }).selectOption('2026');
  await page.waitForFunction(() => document.querySelector('.balance-overview')?.getAttribute('aria-busy') === 'false');
}

async function checkLayout(page, width) {
  const layout = await page.evaluate(() => {
    const page = document.querySelector('.balance-page').getBoundingClientRect();
    const problems = [];
    for (const element of document.querySelectorAll('.balance-overview button, .balance-overview summary, .balance-overview strong, .balance-overview dd, .balance-filter-panel, .balance-margin-detail, .balance-kpi')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || !element.checkVisibility()) continue;
      if (rect.left < page.left - 1 || rect.right > page.right + 1 || element.scrollWidth > element.clientWidth + 2) {
        problems.push({ class: element.className, text: element.textContent.slice(0, 90), left: rect.left, right: rect.right, scroll: element.scrollWidth, width: element.clientWidth });
      }
    }
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, problems };
  });
  assert.ok(layout.document <= layout.viewport, `${width}: horizontal page overflow`);
  assert.deepEqual(layout.problems, [], `${width}: text/controls overflow`);
  console.log(`Layout ${width}px: no horizontal overflow or truncated controls.`);
}

try {
  const { page, context } = await setup();
  await selectPeriod(page);
  assert.equal(await page.locator('.balance-kpi-grid .balance-kpi').count(), 5);
  await page.getByRole('button', { name: 'Fechar composição da margem' }).click();
  assert.equal(await page.locator('#balance-margin-detail').count(), 0);
  await page.getByRole('button', { name: /Margem do período/ }).focus();
  await page.keyboard.press('Enter');
  await page.locator('#balance-margin-detail').waitFor();
  await page.locator('.balance-attention-item--overdue').click();
  assert.equal(await page.locator('#balance-attention-detail .balance-detail-list a').count(), 1);
  assert.equal(await page.locator('#balance-attention-detail a').getAttribute('href'), '/finance?area=clients&invoiceId=1');
  await page.locator('.balance-attention-item--staff').click();
  assert.match(await page.locator('#balance-attention-detail').innerText(), /Miriam Peçanha Oliveira/);
  await page.locator('.balance-attention-item--unbilled').click();
  assert.equal(await page.locator('#balance-attention-detail a').count(), 1);
  assert.match(await page.locator('#balance-attention-detail').innerText(), /Serviço por faturar/);
  await page.getByRole('button', { name: 'Fechar pendências' }).click();
  await page.locator('.balance-forecast summary').click();
  assert.match(await page.locator('.balance-forecast-body').innerText(), /ORC 2026\/1/);
  await page.getByLabel('Cliente', { exact: true }).selectOption('2');
  assert.match(await page.locator('.balance-forecast-body').innerText(), /Sem orçamentos/);
  assert.equal(await page.locator('.balance-forecast-body a').count(), 1);
  await page.getByLabel('Cliente', { exact: true }).selectOption('all');
  await page.getByLabel('Estado', { exact: true }).selectOption('finalized');
  assert.match(await page.locator('.balance-forecast-body').innerText(), /Selecione Todos os estados/);
  await page.getByLabel('Estado', { exact: true }).selectOption('all');
  await page.locator('.balance-forecast summary').click();
  for (const width of [1600, 1280, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1040 });
    await page.waitForTimeout(1800);
    await checkLayout(page, width);
    assert.ok(await page.locator('.balance-chart .recharts-bar-rectangle').count() > 0, 'Nonempty chart');
    await page.screenshot({ path: `${output}/balancete-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.balance-attention-item--staff').click();
  await page.locator('.balance-forecast summary').click();
  await checkLayout(page, 390);
  await page.screenshot({ path: `${output}/balancete-mobile-detalhes.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.locator('.balance-client-table').waitFor();
  await page.getByRole('button', { name: 'Eventos', exact: true }).click();
  assert.equal(await page.locator('.balance-event-row').count(), 4);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.getByLabel('Mês', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Atual', exact: true }).click();
  assert.equal(await page.getByLabel('Mês', { exact: true }).inputValue(), String(new Date().getMonth() + 1));
  await context.close();

  const failed = await setup({ invoiceError: true });
  await failed.page.locator('.notice').waitFor();
  assert.equal(await failed.page.locator('.balance-kpi-grid .balance-kpi strong').first().textContent(), '—');
  assert.equal(await failed.page.locator('.balance-attention-item--staff').isDisabled(), true);
  await failed.context.close();

  const slow = await setup({ delay: 2000 });
  assert.equal(await slow.page.locator('.balance-overview').getAttribute('aria-busy'), 'true');
  assert.equal(await slow.page.locator('.balance-kpi strong').first().textContent(), '—');
  await slow.page.waitForFunction(() => document.querySelector('.balance-overview')?.getAttribute('aria-busy') === 'false');
  await slow.context.close();

  const restricted = await setup({ restricted: true });
  await selectPeriod(restricted.page);
  assert.doesNotMatch(await restricted.page.locator('.balance-forecast summary').innerText(), /Em análise/);
  await restricted.context.close();
  assert.deepEqual(errors, []);
  assert.equal(mutations, 0);
  console.log('Passed: filters, margin keyboard toggle, pending links, forecasts, tabs, loading, errors and budget permissions. No database writes.');
} finally {
  await browser.close();
}
