// API traffic is intercepted; all payment changes affect in-memory fixtures only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { money } from '../src/utils/formatters.js';
import { withCurrentStaffVatCost } from '../server/utils/eventTotals.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.TEST_BASE_URL || 'http://localhost:5175';
const output = 'node_modules/.cache/staff-payment-tabs';
await mkdir(output, { recursive: true });
const labels = {
  all: 'Todos os serviços', unpaid: 'Colaboradores por Pagar', awaiting_validation: 'Aguardar Validação',
  validated_es: 'Validado ES', awaiting_data: 'Aguardar RV', penhorado: 'Penhorado', ganho: 'Ganho', paid: 'Colaboradores Pagos',
};
const baseline = {
  all: [34, 1226.18], unpaid: [3, 496.18], awaiting_validation: [1, 40],
  validated_es: [1, 50], awaiting_data: [1, 110], penhorado: [1, 75], ganho: [1, 205], paid: [2, 250],
};
const errors = [];

function fixture() {
  const collaborators = ['Miriam Oliveira', 'Ana Rosa', 'Carlos Silva', 'Diego Bem', 'Sofia Rosa', 'Joana IVA', 'Aguardar Horas']
    .map((name, index) => ({ id: index + 1, name, shortName: name, nif: `30000000${index}`, status: 'active', includeVat: index === 5 }));
  const row = (id, collaboratorId, paymentStatus, amount, extra = {}) => ({
    id, collaboratorId, collaborator: collaborators[collaboratorId - 1], role: 'Emp.Mesa', status: 'confirmed',
    paymentStatus, assignmentDate: '2026-09-04', plannedCheckIn: '09:00', plannedCheckOut: '10:00',
    validatedCheckIn: '09:00', validatedCheckOut: '10:00', validationStatus: 'validated',
    hourlyRate: amount, totalPay: amount, paymentAdjustment: 0, ...extra,
  });
  const service = (id, name, status, assignments, extra = {}) => ({
    id, name, status, date: '2026-09-04', startTime: '09:00', endTime: '10:00',
    billingStatus: 'pending', totalRevenue: 0, totalCost: 0, assignments,
    clientId: 1, client: { id: 1, name: 'Cliente QA' }, ...extra,
  });
  return {
    collaborators,
    services: [
      service(10, 'Evento Principal', 'finalized', [
        ...Array.from({ length: 25 }, (_, index) => row(index + 1, 1, 'unpaid', 10.25)),
        row(26, 1, 'paid', 150), row(27, 2, 'unpaid', 100), row(28, 3, 'awaiting_data', 110),
        row(29, 1, 'validated_es', 50), row(30, 4, 'penhorado', 75), row(31, 5, 'ganho', 205), row(32, 2, 'paid', 100),
      ]),
      service(20, 'Evento por validar', 'to_validate_client', [row(33, 7, 'unpaid', 40, { assignmentDate: '2026-09-05' })], { date: '2026-09-05' }),
      service(30, 'Evento com deslocacao', 'finalized', [row(34, 6, 'unpaid', 10, {
        assignmentDate: '2026-09-06', checkIn: '08:00', checkOut: '18:00',
        plannedCheckIn: '08:00', plannedCheckOut: '18:00', validatedCheckIn: '08:00', validatedCheckOut: '16:00',
        paymentAdjustment: -2.5, advancePayments: JSON.stringify([{ amount: 20 }, { amount: 40, car: true }]),
      })], { date: '2026-09-06', travelCars: [
        { id: 'car-qa', label: 'Carro QA', durationHours: 2 },
        { kind: 'staff_compensation', assignmentId: 34, collaboratorId: 6, carId: 'car-qa', durationHours: 0 },
      ] }),
      service(40, 'Mes anterior', 'finalized', [row(35, 2, 'unpaid', 100, { assignmentDate: '2026-08-04' })], { date: '2026-08-04' }),
    ],
  };
}

function tab(page, id) {
  return page.getByRole('tab', { name: new RegExp(`^${labels[id]}\\s`) });
}

async function summary(page, expected) {
  const target = Object.entries(expected).map(([id, [count, amount]]) => ({ label: labels[id], count: String(count), amount: money.format(amount) }));
  await page.waitForFunction((items) => items.every((item) => {
    const button = [...document.querySelectorAll('.finance-payment-tabs [role=tab]')]
      .find((element) => element.querySelector('.finance-payment-tab__label')?.textContent === item.label);
    return button?.querySelector('.finance-payment-tab__count')?.textContent === item.count
      && button?.querySelector('.finance-payment-tab__amount')?.textContent === item.amount;
  }), target, { timeout: 10000 }).catch(async (error) => {
    console.error('Expected tab summary:', target, 'Actual:', await page.locator('.finance-payment-tabs').innerText());
    throw error;
  });
  for (const [id, [count, amount]] of Object.entries(expected)) {
    assert.equal(await tab(page, id).locator('.finance-payment-tab__count').innerText(), String(count));
    assert.equal(await tab(page, id).locator('.finance-payment-tab__amount').textContent(), money.format(amount));
  }
}

async function layout(page) {
  const result = await page.locator('.finance-payment-tabs').evaluate((strip) => {
    const clipped = [...strip.querySelectorAll('button')].filter((button) => {
      const bounds = button.getBoundingClientRect();
      return button.scrollWidth > button.clientWidth + 2 || [...button.children].some((child) => {
        const rect = child.getBoundingClientRect();
        return child.scrollWidth > child.clientWidth + 2 || rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      });
    }).map((element) => element.textContent);
    return { clipped, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(result.clipped, []);
  assert.equal(result.pageOverflow, false);
}

async function setup(width, initial = fixture()) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'test-only-token', user: { id: 1, name: 'Admin QA', role: 'admin' },
    lastActivityAt: new Date('2026-10-07T12:00:00Z').getTime(), sessionId: 'tabs-qa',
  })));
  const data = initial;
  const writes = [];
  const alerts = [];
  let failNextWrite = false;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    const path = url.pathname.slice(4);
    const method = request.method();
    let body = [];
    if (method !== 'GET') {
      writes.push({ path, method, payload: request.postDataJSON() });
      if (failNextWrite) {
        failNextWrite = false;
        return route.fulfill({ status: 409, json: { message: 'Teste: pagamento recusado' } });
      }
      assert.equal(method, 'PUT');
      const updates = path === '/assignments/bulk' ? request.postDataJSON().updates
        : [{ id: Number(path.split('/').at(-1)), data: request.postDataJSON() }];
      assert.ok(path === '/assignments/bulk' || /^\/assignments\/\d+$/.test(path));
      for (const update of updates) {
        const row = data.services.flatMap((event) => event.assignments).find((assignment) => assignment.id === Number(update.id));
        assert.ok(row);
        Object.assign(row, update.data);
        body = row;
      }
    } else if (path === '/services') body = data.services.map(withCurrentStaffVatCost);
    else if (path === '/collaborators') body = data.collaborators;
    else if (path === '/clients') body = [{ id: 1, name: 'Cliente QA' }];
    else if (path === '/settings') body = {};
    return route.fulfill({ status: 200, json: body });
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(`${base}/finance?area=staff`);
  await page.locator('.finance-payment-tabs').waitFor({ timeout: 10000 }).catch(async (error) => {
    console.error('Finance fixture:', page.url(), (await page.locator('body').innerText()).slice(0, 4000), errors);
    throw error;
  });
  return { page, context, data, writes, alerts, failWrite: () => { failNextWrite = true; } };
}

try {
  for (const width of [1440, 768, 390, 320]) {
    const f = await setup(width);
    const { page } = f;
    await summary(page, baseline);
    await layout(page);
    await page.locator('.finance-payment-tabs').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/tabs-${width}.png` });

    // Unpaid and paid rows of Miriam must remain separate in both counts and amounts.
    const collaborator = page.locator('.finance-payment-filters select').nth(1);
    const event = page.locator('.finance-payment-filters select').first();
    await collaborator.selectOption('1');
    await summary(page, { all: [27, 456.25], unpaid: [1, 256.25], paid: [1, 150], validated_es: [1, 50], ganho: [0, 0] });
    await collaborator.selectOption('all');
    await event.selectOption('30');
    await summary(page, { all: [1, 139.93], unpaid: [1, 139.93], paid: [0, 0] });
    await event.selectOption('all');
    const search = page.getByPlaceholder('Nome ou NIF do colaborador');
    await search.fill('Ana');
    await summary(page, { all: [3, 339.93], unpaid: [2, 239.93], paid: [1, 100] });
    await search.fill('nenhum resultado');
    await summary(page, Object.fromEntries(Object.keys(labels).map((id) => [id, [0, 0]])));
    await search.fill('');
    await summary(page, baseline);
    const workDate = page.locator('.finance-payment-filters input[type=date]');
    await workDate.fill('2026-09-06');
    await summary(page, { all: [1, 139.93], unpaid: [1, 139.93], paid: [0, 0] });
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await page.locator('.finance-month-control select').first().selectOption('10');
    await summary(page, baseline);

    // A rejected state change must leave every badge unchanged.
    await page.getByRole('button', { name: 'Consultar serviços de Ana Rosa' }).click();
    f.failWrite();
    await page.locator('.finance-staff-payment-detail-table .payment-state').first().selectOption('paid');
    await page.waitForFunction(() => !document.querySelector('.finance-staff-payment-detail-table .payment-state:disabled'));
    assert.equal(f.alerts.at(-1), 'Teste: pagamento recusado');
    await summary(page, baseline);

    await page.locator('.finance-staff-payment-detail-table .payment-state').first().selectOption('paid');
    await summary(page, { ...baseline, unpaid: [2, 396.18], paid: [2, 350] });
    assert.equal(await tab(page, 'unpaid').getAttribute('aria-selected'), 'true');
    assert.equal(f.data.services[0].assignments.find((row) => row.id === 27).paymentStatus, 'paid');

    // Bulk changes must transfer all 25 row amounts, not just one collaborator amount.
    await page.getByRole('checkbox', { name: 'Selecionar 25 serviços processáveis de Miriam Oliveira', exact: true }).check();
    await page.locator('.finance-bulk-status').selectOption('awaiting_data');
    await page.getByRole('button', { name: 'Aplicar alteração', exact: true }).click();
    await summary(page, { ...baseline, unpaid: [1, 139.93], paid: [2, 350], awaiting_data: [26, 366.25] });
    assert.equal(f.writes.at(-1).payload.updates.length, 25);
    assert.equal(await tab(page, 'unpaid').getAttribute('aria-selected'), 'true');

    await tab(page, 'awaiting_data').click();
    await page.getByRole('checkbox', { name: 'Selecionar 25 serviços processáveis de Miriam Oliveira', exact: true }).check();
    await page.locator('.finance-bulk-status').selectOption('paid');
    await page.getByRole('button', { name: 'Aplicar alteração', exact: true }).click();
    await summary(page, { ...baseline, unpaid: [1, 139.93], paid: [2, 606.25] });
    assert.equal(f.writes.at(-1).payload.updates.length, 25);
    assert.equal(await tab(page, 'awaiting_data').getAttribute('aria-selected'), 'true');

    await tab(page, 'paid').click();
    await page.getByRole('button', { name: 'Consultar serviços de Miriam Oliveira' }).click();
    const payment = page.locator('.finance-staff-payment-detail-table .payment-state').first();
    await payment.selectOption('validated_es');
    await summary(page, { ...baseline, unpaid: [1, 139.93], paid: [2, 596], validated_es: [2, 60.25] });
    await tab(page, 'validated_es').click();
    await page.getByRole('button', { name: 'Consultar serviços de Miriam Oliveira' }).click();
    const adjustment = page.locator('.finance-staff-payment-detail-table .finance-adjustment-input').first();
    await adjustment.fill('-2,50');
    await summary(page, { all: [34, 1223.68], validated_es: [2, 57.75], paid: [2, 596] });
    await adjustment.blur();
    await page.waitForFunction(() => !document.querySelector('.finance-staff-payment-detail-table .finance-adjustment-input:disabled'));
    assert.equal(f.data.services[0].assignments[0].paymentAdjustment, -2.5);
    await layout(page);
    await page.reload();
    await summary(page, { all: [34, 1223.68], unpaid: [1, 139.93], paid: [2, 596], validated_es: [2, 57.75] });
    await f.context.close();
    console.log(`${width}px: all tab totals/counts, VAT/travel/advances, filters, individual save/failure, 25-row bulk transitions, adjustment and reload passed`);
  }

  // Exact IVA regression: display receipt bases while keeping real gross costs.
  for (const width of [1440, 768, 390, 320]) {
    const iva = { id: 1, name: 'Ana Carolina Rodrigues', shortName: 'Ana Carolina Rodrigues', includeVat: true, status: 'active' };
    const exempt = { id: 2, name: 'Sem IVA', includeVat: false, status: 'active' };
    const assignments = [[5, 8.5, -2.5], [12, 8, -12], [10, 8, 0], [11.5, 8, 0]].map(([hours, rate, adjustment], index) => ({
      id: index + 1, eventId: 1, collaboratorId: 1, collaborator: iva, role: 'Emp.Mesa', status: 'confirmed', paymentStatus: 'unpaid',
      assignmentDate: '2026-09-04', hoursWorked: hours, staffPayableHours: hours, clientRealHours: hours,
      hourlyRate: rate, paymentAdjustment: adjustment,
    }));
    const data = { collaborators: [iva, exempt], services: [
      { id: 1, name: 'Caso 38h30 IVA', date: '2026-09-04', status: 'finalized', billingStatus: 'pending', clientId: 1,
        totalRevenue: 1000, totalCost: 367.41, taxAmount: 0, assignments },
      { id: 2, name: 'Sem IVA', date: '2026-09-04', status: 'finalized', billingStatus: 'pending', clientId: 1,
        totalRevenue: 500, totalCost: 40, taxAmount: 0, assignments: [{ ...assignments[0], id: 50, eventId: 2, collaboratorId: 2, collaborator: exempt }] },
    ] };
    const f = await setup(width, data);
    const { page } = f;
    await tab(page, 'all').click();
    await summary(page, { all: [5, 404.08], unpaid: [2, 404.08], paid: [0, 0] });
    const group = page.locator('.finance-staff-payment-group-row').filter({ hasText: 'Ana Carolina Rodrigues' });
    const groupAmount = (index) => group.locator(':scope > td').nth(index).locator('.finance-payment-amount');
    assert.equal(await groupAmount(5).locator('> strong').textContent(), money.format(296));
    assert.equal(await groupAmount(5).locator('.finance-payment-amount__vat').textContent(), `${money.format(364.08)} c/ IVA`);
    assert.match(await group.innerText(), /IVA 23%/);
    await page.getByRole('button', { name: 'Consultar serviços de Ana Carolina Rodrigues', exact: true }).click();
    const rows = page.locator('.finance-staff-payment-detail-table tbody tr');
    assert.deepEqual(await rows.locator('.finance-pay-total .finance-payment-amount > strong').allTextContents(), [40, 84, 80, 92].map((value) => money.format(value)));
    assert.deepEqual(await rows.locator('.finance-pay-total .finance-payment-amount__vat').allTextContents(), [49.2, 103.32, 98.4, 113.16].map((value) => `${money.format(value)} c/ IVA`));
    await layout(page);
    const clipped = await page.locator('.finance-payment-amount').evaluateAll((elements) => elements.filter((element) => element.checkVisibility() && element.scrollWidth > element.clientWidth + 2).map((element) => element.textContent));
    assert.deepEqual(clipped, []);
    await page.screenshot({ path: `${output}/staff-iva-${width}.png`, fullPage: true, animations: 'disabled' });
    await rows.first().locator('.payment-state').selectOption('paid');
    await summary(page, { all: [5, 404.08], paid: [1, 49.2], unpaid: [2, 354.88] });
    assert.equal(await groupAmount(6).locator('> span').first().textContent(), money.format(40));
    assert.equal(await groupAmount(7).locator('> strong').textContent(), money.format(256));
    await page.getByRole('checkbox', { name: 'Selecionar 4 serviços processáveis de Ana Carolina Rodrigues', exact: true }).check();
    await page.locator('.finance-bulk-status').selectOption('paid');
    await page.getByRole('button', { name: 'Aplicar alteração', exact: true }).click();
    await summary(page, { all: [5, 404.08], paid: [1, 364.08], unpaid: [1, 40] });
    assert.equal(f.writes.at(-1).payload.updates.length, 4);
    assert.equal(await groupAmount(6).locator('> span').first().textContent(), money.format(296));
    assert.equal(await groupAmount(7).locator('> strong').textContent(), money.format(0));
    const adjustment = rows.first().locator('.finance-adjustment-input');
    await adjustment.fill('+10,00');
    await adjustment.blur();
    await summary(page, { all: [5, 419.46], paid: [1, 379.46], unpaid: [1, 40] });
    assert.equal(await groupAmount(5).locator('> strong').textContent(), money.format(308.5));
    await page.goto(`${base}/balancete`);
    await page.getByLabel('Ano', { exact: true }).selectOption('2026');
    await page.getByLabel('Mês', { exact: true }).selectOption('9');
    assert.equal(await page.locator('.balance-kpi--staff strong').textContent(), money.format(419.46));
    await page.locator('.balance-tabs').getByRole('button', { name: 'Staff', exact: true }).click();
    assert.equal(await page.locator('.balance-staff-totals .balance-kpi').first().locator('strong').textContent(), money.format(419.46));
    await f.context.close();
    console.log(`${width}px: exact receipt bases, IVA totals, individual/bulk state changes, positive adjustment and gross Balancete costs passed`);
  }

  // Pagination must not limit totals; large values must remain inside the controls.
  const data = fixture();
  data.services = [{ ...data.services[0], assignments: Array.from({ length: 50 }, (_, index) => ({
    ...data.services[0].assignments[0], id: index + 1, collaboratorId: index + 1,
    collaborator: { id: index + 1, name: `Staff ${index + 1}` }, hourlyRate: 246913.5, paymentStatus: 'paid',
  })) }];
  const f = await setup(320, data);
  await summary(f.page, { all: [50, 12345675], paid: [50, 12345675], unpaid: [0, 0] });
  await tab(f.page, 'paid').click();
  assert.equal(await f.page.locator('.finance-staff-payment-group-row').count(), 10);
  await layout(f.page);
  await f.page.locator('.finance-payment-tabs').scrollIntoViewIfNeeded();
  await f.page.screenshot({ path: `${output}/tabs-large-320.png` });
  await f.context.close();
  assert.deepEqual(errors, []);
  console.log('50 collaborators: totals include all pages and large currency values fit at 320px; no real data changed');
} finally {
  await browser.close();
}
