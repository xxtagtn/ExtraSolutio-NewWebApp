// Every API request is mocked. No real hours, invoices or payments are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { calculateEventTotals } from '../server/utils/eventTotals.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
const output = 'node_modules/.cache/finance-validated-schedule';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date('2026-11-12T12:00:00Z');
const money = (value) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);

function fixture() {
  const client = { id: 1, name: 'SUPREME QA', billingMethod: 'per_event', paymentTerm: 'days_15' };
  const collaborator = { id: 1, name: 'Colaborador LX Factory QA', hourlyRate: 8 };
  const event = { id: 42, name: 'Evento Externo - LX Factory QA', clientId: 1, client,
    date: '2026-11-06', status: 'finalized', statusMode: 'manual', billingStatus: 'pending',
    startTime: '17:00', endTime: '22:00', location: 'LX Factory', minimumHoursSnapshot: 0,
    staffVatRateSnapshot: 23, vatRateSnapshot: 23,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 10.2 }], externalCosts: [],
    assignments: [{ id: 1, eventId: 42, collaboratorId: 1, collaborator, assignmentDate: '2026-11-06',
      role: 'Emp.Mesa', status: 'confirmed', hourlyRate: 8,
      plannedCheckIn: '17:00', plannedCheckOut: '22:00', checkIn: '17:01', checkOut: '22:04',
      clientCheckIn: '17:05', clientCheckOut: '21:50', validatedCheckIn: '17:10', validatedCheckOut: '21:56',
      validationStatus: 'validated', paymentStatus: 'unpaid' }] };
  return { ...event, ...calculateEventTotals(event, event.assignments) };
}

let lastPage;
const errors = [];
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 },
      serviceWorkers: 'block', timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'schedule-qa', user: { id: 1, role: 'admin', name: 'QA' },
      sessionId: 'schedule-qa', lastActivityAt: timestamp,
    })), now.getTime());
    let stored = fixture();
    const writes = [];
    await context.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') {
        writes.push(url.pathname);
        return route.fulfill({ status: 405, json: {} });
      }
      return route.fulfill({ json: {
        '/api/services': [stored], '/api/clients': [stored.client],
        '/api/collaborators': [stored.assignments[0].collaborator],
      }[url.pathname] || [] });
    });
    const page = await context.newPage();
    lastPage = page;
    await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    const before = structuredClone(stored);
    const openSummary = async () => {
      await page.goto(`${base}/finance?area=clients&eventId=42`);
      await page.locator('.finance-client-summary-row').filter({ hasText: stored.client.name }).click();
      await page.getByRole('button', { name: `Ver resumo de ${stored.name}`, exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Resumo do Evento/Servi\u00e7o', exact: true });
      await modal.locator('.finance-event-day-row summary').click();
      return modal;
    };
    let modal = await openSummary();
    const entries = modal.locator('.finance-event-day-entries');
    await entries.getByText('Emp.Mesa \u00b7 17:10 - 21:56', { exact: true }).waitFor();
    assert.equal(await entries.getByText(/17:00 - 22:00/).count(), 0);
    assert.equal(await entries.getByText(/17:05 - 21:50/).count(), 0);
    assert.ok((await entries.textContent()).includes(`5:00h \u00d7 ${money(10.2)}/h = ${money(51)}`));
    assert.equal(await modal.locator('.finance-event-summary__heading > strong').textContent(), money(62.73));
    assert.equal(await entries.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
    await modal.screenshot({ path: `${output}/validated-${width}.png` });
    assert.deepEqual(stored, before);

    delete stored.assignments[0].validatedCheckIn;
    delete stored.assignments[0].validatedCheckOut;
    stored.assignments[0].clientCheckIn = '17:10';
    stored.assignments[0].clientCheckOut = '21:56';
    modal = await openSummary();
    await modal.locator('.finance-event-day-entries').getByText('Emp.Mesa \u00b7 17:10 - 21:56', { exact: true }).waitFor();

    delete stored.assignments[0].clientCheckIn;
    delete stored.assignments[0].clientCheckOut;
    modal = await openSummary();
    await modal.locator('.finance-event-day-entries')
      .getByText('Emp.Mesa \u00b7 Hor\u00e1rio validado n\u00e3o registado', { exact: true }).waitFor();
    assert.equal(await modal.locator('.finance-event-summary__heading > strong').textContent(), money(62.73));
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: exact validated clocks, client fallback, no planned/staff fallback, 5h/51.00/62.73 preserved, no writes`);
  }
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    console.error(lastPage.url(), (await lastPage.locator('body').innerText()).slice(0, 2500), errors);
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
