// API responses are simulated; this test never writes application data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildAttendanceAttention } from '../server/services/attendanceAttention.js';
import { eventStartInstant } from '../server/utils/eventTime.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = 'node_modules/.cache/dashboard-attendance';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const timeZone = 'Europe/Lisbon';
const event = { id: 10, name: 'Restaurante Luz Chakall', clientName: 'SUPREME',
  date: '2026-09-01', endDate: '2026-09-30', isContinuous: true,
  status: 'confirmed', workLocationsEnabled: true, requiredRoles: [] };
const assignment = (id, name, changes = {}) => ({
  id, eventId: 10, collaboratorId: id, assignmentDate: '2026-09-25',
  plannedCheckIn: '11:00', plannedCheckOut: '15:00', checkIn: null, checkOut: null,
  status: 'confirmed', validationStatus: 'pending', role: 'Emp.Mesa',
  collaborator: { id, name, status: 'active' }, workLocation: { name: 'Lounge A' }, event, ...changes,
});

try {
  for (const width of [320, 390, 900, 1440]) {
    const rows = [
      assignment(1, 'Ana Isabel Domingues'),
      assignment(2, 'Bruno Costa', { plannedCheckIn: '07:00', plannedCheckOut: '11:00', checkIn: '07:02' }),
      assignment(3, 'Carla Silva', { checkOut: '11:20' }),
      assignment(4, 'Diana Santos', { plannedCheckIn: '12:05', plannedCheckOut: '16:00' }),
      assignment(5, 'Eva Reis', { checkIn: '11:00', checkOut: '11:30' }),
      assignment(6, 'Filipe Reis', { status: 'missed_justified' }),
      assignment(7, 'Gabriel Reis', { event: { ...event, cancelledDays: '["2026-09-25"]' } }),
      assignment(8, 'Helena Oliveira', { assignmentDate: '2026-09-24', plannedCheckIn: '22:00', plannedCheckOut: '02:00', checkIn: '22:00' }),
      ...[9, 10, 11].map((id) => assignment(id, `Colaborador de nome comprido ${id}`)),
      assignment(12, 'Servico futuro', { assignmentDate: '2026-09-26' }),
    ];
    let now = eventStartInstant('2026-09-25', '12:00', timeZone);
    let fail = false;
    let requests = 0;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: timeZone });
    await context.addInitScript(() => {
      if (!localStorage.getItem('extrasolutio.auth')) localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'ui-test', user: { id: 1, role: 'admin' } }));
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.route('**/api/**', async (route) => {
      assert.equal(route.request().method(), 'GET', 'Dashboard alerts must not mutate attendance');
      const path = new URL(route.request().url()).pathname.replace('/api', '');
      const send = (json) => route.fulfill({ json });
      if (path === '/notifications/attendance-attention') {
        requests += 1;
        if (fail) return route.fulfill({ status: 503, json: { message: 'Serviço temporariamente indisponível' } });
        return send(buildAttendanceAttention(rows, { now, timeZone }));
      }
      if (path === '/notifications/overview') return send({ notifications: { total: 0, items: [], allItems: [] }, reminders: [] });
      if (path === '/notifications/ignored') return send([]);
      if (path === '/services') return send([{ ...event, assignments: rows.map(({ event: _event, ...row }) => row) }]);
      if (path === '/collaborators') return send(rows.map((row) => row.collaborator));
      if (path === '/budgets' || path === '/invoices') return send([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto(`${baseUrl}/dashboard`);
    const panel = page.getByRole('region', { name: 'Picagens a precisar de atenção' });
    const links = panel.locator('.command-attendance-row');
    await panel.getByRole('button', { name: 'Mostrar mais (1)' }).waitFor();
    assert.equal(await links.count(), 6);
    await panel.getByRole('button', { name: 'Mostrar mais (1)' }).click();
    assert.equal(await links.count(), 7);
    const filter = panel.getByRole('combobox', { name: 'Filtrar alertas de picagens' });
    await filter.selectOption('missing_exit');
    assert.equal(await links.count(), 2);
    assert.match(await panel.innerText(), /Bruno Costa/);
    assert.match(await panel.innerText(), /Helena Oliveira/);
    await filter.selectOption('incomplete');
    assert.equal(await links.count(), 1);
    assert.match(await panel.innerText(), /Carla Silva/);
    const expandedHeight = (await panel.boundingBox()).height;
    await panel.getByRole('button', { name: 'Minimizar picagens' }).click();
    const expand = panel.getByRole('button', { name: 'Expandir picagens' });
    assert.equal(await expand.getAttribute('aria-expanded'), 'false');
    assert.equal(await expand.evaluate((button) => document.activeElement === button), true, 'The toggle keeps keyboard focus');
    assert.equal(await panel.locator('#attendance-attention-content').isVisible(), false);
    assert.equal(await links.count(), 0, 'Collapsed rows are not rendered');
    assert.equal(await filter.count(), 0);
    await panel.getByLabel('7 alertas de picagens', { exact: true }).waitFor();
    assert.ok((await panel.boundingBox()).height < expandedHeight);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/collapsed-${width}.png` });
    rows[0].checkIn = '11:01';
    const collapsedRequests = requests;
    await page.clock.fastForward(15000);
    await panel.getByLabel('6 alertas de picagens', { exact: true }).waitFor();
    assert.ok(requests > collapsedRequests, 'The count continues updating while collapsed');
    await expand.press('Enter');
    assert.equal(await filter.inputValue(), 'incomplete', 'Collapsing preserves the filter');
    assert.equal(await links.count(), 1);
    rows[0].checkIn = null;
    await panel.getByRole('button', { name: 'Atualizar picagens' }).click();
    await panel.getByLabel('7 alertas de picagens', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Minimizar picagens' }).press('Space');
    await page.reload();
    await expand.waitFor();
    assert.equal(await links.count(), 0, 'Collapsed preference survives a reload');
    await expand.click();
    await panel.getByLabel('7 alertas de picagens', { exact: true }).waitFor();
    await filter.selectOption('all');
    await page.getByRole('button', { name: 'Procurar', exact: true }).click();
    const search = page.getByPlaceholder('Procurar ação, cliente ou evento');
    await search.fill('Ana Isabel');
    assert.equal(await links.count(), 1);
    await search.fill('Ninguem');
    await panel.getByText('Sem picagens para estes filtros.').waitFor();
    await search.fill('');

    rows[0].checkIn = '11:01';
    const previousRequests = requests;
    await page.clock.fastForward(15000);
    await panel.getByRole('option', { name: 'Todas (6)', exact: true }).waitFor({ state: 'attached' });
    assert.ok(requests > previousRequests, 'A background refresh should occur');
    assert.equal(await panel.getByText('Ana Isabel Domingues', { exact: true }).count(), 0);
    now = eventStartInstant('2026-09-25', '12:06', timeZone);
    await page.clock.fastForward(15000);
    await panel.getByRole('option', { name: 'Todas (7)', exact: true }).waitFor({ state: 'attached' });
    await panel.getByRole('button', { name: 'Mostrar mais (1)' }).click();
    await panel.getByText('Diana Santos', { exact: true }).waitFor();

    fail = true;
    await panel.getByRole('button', { name: 'Atualizar picagens' }).click();
    await panel.getByRole('alert').waitFor();
    assert.match(await panel.getByRole('alert').innerText(), /última atualização/);
    assert.equal(await links.count(), 7, 'Previously loaded alerts survive a temporary error');
    fail = false;
    await panel.getByRole('button', { name: 'Atualizar picagens' }).click();
    await panel.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
    const clipped = await panel.locator('strong, span, small, button, .badge').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent));
    assert.deepEqual(clipped, [], 'Alert text and controls must not be clipped');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/dashboard-${width}.png` });

    await panel.getByRole('link', { name: 'Abrir serviço de Helena Oliveira: Saída por registar' }).click();
    await page.locator('.service-detail-day-tabs .service-tab--active').waitFor();
    assert.match(await page.locator('.service-detail-day-tabs .service-tab--active').innerText(), /24\/09/);
    assert.match(await page.locator('.service-tab.service-tab--active').first().innerText(), /Colaboradores/);
    assert.equal(new URL(page.url()).pathname, '/services/10');
    await page.goto(`${baseUrl}/services/10?tab=team&day=2026-09-25&push=1`);
    await page.waitForFunction(() => document.querySelector('.service-detail-day-tabs .service-tab--active')?.textContent.includes('25/09'));

    rows.push(
      assignment(13, 'Bruno Costa', { collaboratorId: 2, plannedCheckIn: '11:30', plannedCheckOut: '18:00',
        workLocation: { name: 'Lounge VIP' }, event: { ...event, id: 11, name: 'Restaurante Mar' } }),
      assignment(14, 'Bruno Costa'),
      assignment(15, 'Bruno Costa', { collaboratorId: 2, assignmentDate: '2026-09-24',
        plannedCheckIn: '21:00', plannedCheckOut: '23:00', checkIn: '21:00' }),
    );
    await page.goto(`${baseUrl}/dashboard`);
    await panel.getByLabel('10 alertas de picagens', { exact: true }).waitFor();
    assert.equal(await links.count(), 6);
    const grouped = links.filter({ hasText: 'Restaurante Mar' });
    assert.equal(await grouped.count(), 1);
    assert.equal(await grouped.locator('.command-attendance-person strong').count(), 1);
    assert.equal(await grouped.locator('.command-attendance-service').count(), 2, 'Show-more must not split a collaborator/day group');
    assert.match(await grouped.innerText(), /07:00 → 11:00/);
    assert.match(await grouped.innerText(), /11:30 → 18:00/);
    assert.match(await grouped.innerText(), /Lounge A/);
    assert.match(await grouped.innerText(), /Lounge VIP/);
    assert.deepEqual(await grouped.getByRole('link').evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))), [
      '/services/10?tab=team&day=2026-09-25', '/services/11?tab=team&day=2026-09-25',
    ]);
    await panel.getByRole('button', { name: 'Mostrar mais (3)' }).click();
    assert.equal(await links.count(), 9, 'Ten independent alerts render as nine collaborator/day rows');
    assert.equal(await panel.locator('.command-attendance-person strong').getByText('Bruno Costa', { exact: true }).count(), 3, 'Different people with the same name and different days remain separate');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await grouped.locator('strong, span, small, .badge').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent)), []);
    await grouped.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/grouped-${width}.png` });
    await filter.selectOption('missing_exit');
    assert.equal(await links.count(), 3, 'Existing per-service status filters remain unchanged');
    assert.equal(await panel.getByText('Restaurante Mar', { exact: false }).count(), 0);
    await filter.selectOption('all');
    rows[1].checkOut = '11:02';
    await page.clock.fastForward(15000);
    await panel.getByLabel('9 alertas de picagens', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Mostrar mais (3)' }).click();
    assert.equal(await grouped.locator('.command-attendance-service').count(), 1, 'Resolving one service retains the other alert in the same row');
    rows.find((row) => row.id === 13).checkIn = '11:31';
    await page.clock.fastForward(15000);
    await panel.getByLabel('8 alertas de picagens', { exact: true }).waitFor();
    assert.equal(await grouped.count(), 0);

    for (const row of rows) { row.checkIn = '11:00'; row.checkOut = '15:00'; }
    await page.goto(`${baseUrl}/dashboard`);
    await panel.getByText('Sem picagens a precisar de atenção.').waitFor();
    const allowedRequests = requests;
    await page.evaluate(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'ui-test', user: { id: 2, role: 'operations', permissions: ['dashboard.view'] } })));
    await page.reload();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await page.clock.fastForward(15000);
    assert.equal(await panel.count(), 0, 'Users without service permission must not see attendance data');
    assert.equal(requests, allowedRequests, 'No attendance request without permission');
    await context.close();
    console.log(`Attendance filters, polling, corrections, errors, permissions, day links and layout passed at ${width}px`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
