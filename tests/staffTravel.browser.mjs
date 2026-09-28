// Run against Vite with an optional absolute path to Playwright's index.mjs.
// All API traffic is intercepted; no real records or sessions are used.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEvent, normalizeAssignment } from '../server/routes/crud.js';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { assertStaffTravelConfiguration } from '../server/utils/staffTravelProtection.js';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.argv[3] || undefined });
const baseUrl = process.argv[4] || process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const collaborator = { id: 10, name: 'Ana QA', shortName: 'Ana QA', hourlyRate: 10, status: 'active', roles: ['Emp.Mesa'] };
const client = { id: 2, name: 'Cliente QA', minimumHours: 0, roleRates: [{ role: 'Emp.Mesa', rate: 14 }], billingMethod: 'per_event', paymentTerm: '30 dias', paymentTermDays: 30 };
const assignment = { id: 1, eventId: 30, collaboratorId: 10, collaborator, role: 'Emp.Mesa', status: 'confirmed', hourlyRate: 10,
  plannedCheckIn: '08:30', plannedCheckOut: '22:30', checkIn: '08:30', checkOut: '22:30',
  clientCheckIn: '08:30', clientCheckOut: '22:30', validatedCheckIn: '08:30', validatedCheckOut: '22:30',
  validationStatus: 'validated', clientSynced: true, paymentStatus: 'unpaid' };

try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['mobile-compact', { width: 360, height: 780 }]]) {
    let service = { id: 30, name: 'Salvaterra QA', date: '2026-09-27T00:00:00.000Z', clientId: 2, client,
      eventType: 'Catering', startTime: '08:30', endTime: '22:30', status: 'to_validate_client', statusMode: 'manual',
      requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }], assignments: [structuredClone(assignment)],
      billingStatus: 'pending', travelType: 'kilometers', split5050: true, travelExpenseEnabled: true, travelExpenseAmount: 58,
      travelCars: [{ id: 'car-1', label: 'Carro 1', km: 120, kmRate: 0.4, durationHours: 2, travelPeople: 1, travelStaffHourlyRate: 10 }],
      totalRevenue: 254, totalCost: 140, vatRateSnapshot: 0, taxAmount: 0,
    };
    let saves = 0;
    const errors = [];
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only-token', user: { id: 1, name: 'Admin QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'qa',
    })));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) {
        if (url.origin !== new URL(baseUrl).origin) return route.abort();
        return route.continue();
      }
      const path = url.pathname.slice(4);
      let body = [];
      try {
        if (path === '/services/30' && route.request().method() === 'PUT') {
          const data = normalizeEvent(route.request().postDataJSON());
          assertStaffTravelConfiguration(service, { ...service, ...data }, service.assignments);
          service = { ...service, ...data };
          service = { ...service, ...calculateEventTotals(service) };
          saves += 1;
          body = service;
        } else if (path === '/assignments/1' && route.request().method() === 'PUT') {
          service.assignments[0] = { ...service.assignments[0], ...normalizeAssignment(route.request().postDataJSON()) };
          service = { ...service, ...calculateEventTotals(service) };
          body = service.assignments[0];
        } else if (path === '/services') body = [service];
        else if (path === '/services/30') body = service;
        else if (path === '/clients') body = [client];
        else if (path === '/collaborators') body = [collaborator];
        else if (path === '/collaborators/roles') body = ['Emp.Mesa'];
        else if (path === '/settings') body = {};
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      } catch (error) {
        errors.push(error.message);
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: error.message }) });
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().startsWith(baseUrl)) console.error('Asset:', response.status(), response.url());
    });
    await page.goto(`${baseUrl}/services?serviceId=30`);
    const summary = page.locator('.staff-travel-auto-summary');
    await summary.waitFor({ timeout: 10000 }).catch(async (error) => {
      console.error(page.url(), (await page.locator('body').innerText()).slice(0, 4000), errors);
      throw error;
    });
    await page.getByText('Aplicada automaticamente a 1 colaborador(es) confirmado(s), 1h por colaborador e dia.', { exact: true }).waitFor();
    assert.equal(await summary.locator('input[type="checkbox"]').count(), 0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await summary.waitFor({ state: 'detached' });
    assert.equal(saves, 1);
    assert.equal(service.totalCost, 150);
    assert.equal(service.totalRevenue, 254);
    assert.equal(service.assignments[0].checkIn, '08:30');
    assert.equal(service.assignments[0].checkOut, '22:30');
    await page.goto(`${baseUrl}/services?serviceId=30`);
    await summary.waitFor();
    assert.equal(await summary.locator('input[type="checkbox"]').count(), 0);
    await summary.scrollIntoViewIfNeeded();
    const layout = await summary.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { overflow: element.scrollWidth > element.clientWidth + 1, left: bounds.left, right: bounds.right, width: innerWidth };
    });
    assert.equal(layout.overflow, false);
    assert.ok(layout.left >= 0 && layout.right <= layout.width, JSON.stringify(layout));
    await page.screenshot({ path: join(tmpdir(), `staff-travel-${name}.png`) });
    service.status = 'finalized';
    await page.goto(`${baseUrl}/time-validation?eventId=30`);
    const validationTravelSummary = page.locator('.validation-history-table .staff-travel-summary').first();
    await validationTravelSummary.waitFor({ timeout: 10000 }).catch(async (error) => {
      console.error('Validation:', (await page.locator('body').innerText()).slice(-4500), errors);
      throw error;
    });
    assert.equal(await validationTravelSummary.locator('small').count(), 1);
    assert.match(await validationTravelSummary.innerText(), /Desloc\./);
    assert.doesNotMatch(await validationTravelSummary.innerText(), /Total staff/);
    const historyRow = page.locator('.validation-history-table tbody tr.validation-row').first();
    if (viewport.width <= 760) {
      assert.equal(await historyRow.evaluate((element) => getComputedStyle(element).display), 'grid',
        'Mobile validation history should render as readable cards');
      const historyBounds = await historyRow.evaluate((element) => {
        const details = element.closest('.validation-history-details');
        return { scrollWidth: details.scrollWidth, clientWidth: details.clientWidth };
      });
      assert.ok(historyBounds.scrollWidth <= historyBounds.clientWidth + 1,
        `Mobile validation history overflows horizontally: ${JSON.stringify(historyBounds)}`);
    }
    await validationTravelSummary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), `staff-travel-validation-${name}.png`) });
    await page.goto(`${baseUrl}/finance?area=staff&assignmentId=1`);
    const travelSummary = page.locator('.finance-staff-payment-table .staff-travel-summary').first();
    await travelSummary.waitFor();
    const costRow = page.locator('.finance-cost-table tbody tr').first();
    if (viewport.width <= 760) {
      assert.equal(await costRow.evaluate((element) => getComputedStyle(element).display), 'grid',
        'Mobile collaborator costs should render as labeled cards');
      const costLayout = await costRow.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        firstLabel: getComputedStyle(element.querySelector('td'), '::before').content,
      }));
      assert.ok(costLayout.scrollWidth <= costLayout.clientWidth + 1,
        `Mobile collaborator costs overflow horizontally: ${JSON.stringify(costLayout)}`);
      assert.match(costLayout.firstLabel, /Colaborador/);
      await costRow.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(tmpdir(), `staff-travel-finance-costs-${name}.png`) });
    }
    const travelBounds = await travelSummary.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const cell = element.closest('td').getBoundingClientRect();
      return { summaryLeft: bounds.left, summaryRight: bounds.right, cellLeft: cell.left, cellRight: cell.right };
    });
    assert.ok(travelBounds.summaryLeft >= travelBounds.cellLeft - 1 && travelBounds.summaryRight <= travelBounds.cellRight + 1,
      `Staff travel summary overflows the Hours column: ${JSON.stringify(travelBounds)}`);
    const payment = page.locator('tr').filter({ has: page.locator('.staff-travel-summary') }).first();
    if (viewport.width <= 760) {
      assert.equal(await payment.evaluate((element) => getComputedStyle(element.querySelector('td:nth-child(6)')).gridTemplateColumns.split(' ').length), 2,
        'Mobile finance cells should keep labels aligned beside values');
      assert.equal(await payment.evaluate((element) => getComputedStyle(element.querySelector('.finance-staff-actions')).gridTemplateColumns.split(' ').length), 2,
        'Mobile finance actions should use two compact columns');
      assert.equal(await payment.evaluate((element) => getComputedStyle(element.querySelector('.finance-client-schedule')).whiteSpace), 'normal',
        'Mobile client hours should wrap cleanly beside their label');
      const advanceHighlight = await payment.evaluate((element) => {
        const wasSelected = element.classList.contains('finance-row-selected');
        element.classList.remove('finance-row-selected');
        element.classList.add('finance-row-advance');
        const cell = getComputedStyle(element.querySelector('td:nth-child(4)')).backgroundColor;
        const card = getComputedStyle(element).backgroundColor;
        element.classList.remove('finance-row-advance');
        if (wasSelected) element.classList.add('finance-row-selected');
        return { cell, card };
      });
      assert.equal(advanceHighlight.cell, 'rgba(0, 0, 0, 0)',
        'Mobile advance rows should not tint every individual field');
      assert.notEqual(advanceHighlight.card, 'rgba(0, 0, 0, 0)',
        'Mobile advance rows should keep a uniform card background');
    }
    assert.match(await payment.innerText(), /150,00/);
    assert.match(await payment.innerText(), /14:00h/);
    await payment.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), `staff-travel-finance-${name}.png`) });
    await page.goto(`${baseUrl}/finance?area=clients&eventId=30&month=2026-09`);
    const clientSummaryRow = page.locator('.finance-client-financial-table .finance-client-summary-row').first();
    await clientSummaryRow.waitFor({ timeout: 10000 });
    await clientSummaryRow.click();
    const eventSummaryTrigger = page.locator('.finance-client-event-row--clickable .finance-client-event-name').first();
    await eventSummaryTrigger.waitFor({ timeout: 10000 }).catch(async (error) => {
      console.error('Client finance:', (await page.locator('body').innerText()).slice(-4500), errors);
      throw error;
    });
    await eventSummaryTrigger.click();
    const eventSummaryDialog = page.getByRole('dialog', { name: 'Resumo do Evento/Serviço' });
    await eventSummaryDialog.waitFor({ timeout: 5000 }).catch(async (error) => {
      console.error('Event summary:', (await page.locator('body').innerText()).slice(-3000), errors);
      throw error;
    });
    const scheduleSummary = eventSummaryDialog.locator('.finance-event-schedule-summary').first();
    assert.match(await scheduleSummary.innerText(), /1 colaborador/);
    assert.match(await scheduleSummary.innerText(), /08:30 - 22:30/);
    assert.match(await scheduleSummary.innerText(), /14:00h faturadas/);
    await scheduleSummary.click();
    const scheduleDetails = eventSummaryDialog.locator('.finance-event-schedule-details');
    await scheduleDetails.waitFor();
    assert.match(await scheduleDetails.innerText(), /27\/09\/2026/);
    assert.match(await scheduleDetails.innerText(), /Ana QA/);
    assert.match(await scheduleDetails.innerText(), /Emp\.Mesa/);
    assert.match(await scheduleDetails.innerText(), /08:30 - 22:30/);
    assert.match(await scheduleDetails.innerText(), /14:00h faturadas/);
    await page.screenshot({ path: join(tmpdir(), `staff-travel-finance-client-summary-${name}.png`) });
    service.status = 'to_validate_staff';
    service.assignments[0].checkIn = '';
    service.assignments[0].checkOut = '';
    service.assignments[0].validationStatus = 'reopened';
    await page.goto(`${baseUrl}/time-validation?eventId=30`);
    const pendingValidationSummary = page.locator('.validation-table .staff-travel-summary').first();
    await pendingValidationSummary.waitFor({ timeout: 10000 });
    assert.equal(await pendingValidationSummary.locator('small').count(), 1);
    assert.match(await pendingValidationSummary.innerText(), /Desloc\./);
    assert.doesNotMatch(await pendingValidationSummary.innerText(), /Total staff/);
    assert.ok(await pendingValidationSummary.locator('small').evaluate((element) => element.getBoundingClientRect().height <= 18),
      'Validation travel hint should remain on one compact line');
    await pendingValidationSummary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), `staff-travel-validation-pending-${name}.png`) });
    service.assignments[0].paymentStatus = 'paid';
    await page.goto(`${baseUrl}/services?serviceId=30`);
    await summary.waitFor();
    assert.equal(await summary.locator('input[type="checkbox"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${name}: automatic eligibility, save/reopen, 50/50, untouched clocks, totals, validation, finance and layout passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
