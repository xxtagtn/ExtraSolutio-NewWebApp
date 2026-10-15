// Mocked API only: no real events, receipts or outbound messages are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeEvent, normalizeAssignment } from '../server/routes/crud.js';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { CLIENT_PAYMENT_FIELDS, assertClientSignalHistoryPreserved } from '../src/utils/clientPayment.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const now = new Date('2026-10-15T12:00:00Z');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const width of [390, 1440]) {
    for (const payment of [
      { billingStatus: 'pending', signaledAmount: 30, paidAmount: 60, signaledAt: null, billingPaymentDate: '2026-10-01' },
      { billingStatus: 'partial70', signaledAmount: 30, paidAmount: 45, signaledAt: '2026-10-01', billingPaymentDate: '2026-10-02' },
      { billingStatus: 'partial70', signaledAmount: 30, paidAmount: 30, signaledAt: '2026-10-01', billingPaymentDate: null },
      { billingStatus: 'pending', signaledAmount: 0, paidAmount: 0, signaledAt: null, billingPaymentDate: null },
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Europe/Lisbon' });
      await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa',
        user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'price-receipts-qa' })), now.getTime());
      const page = await context.newPage(); await page.clock.install({ time: now });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
      const client = { id: 1, name: 'Cliente QA', billingMethod: 'per_event', roleRates: '[{"role":"Emp.Mesa","rate":10}]' };
      const collaborator = { id: 1, name: 'Pessoa QA', hourlyRate: 8 };
      const stored = { id: 42, name: 'Particular - Rita Antunes QA', clientId: 1, client, date: '2026-10-16',
        status: 'team_complete', statusMode: 'manual', startTime: '18:00', endTime: '00:00',
        requiredRoles: '[{"role":"Emp.Mesa","qty":1,"agreedRate":10}]', workLocations: [], externalCosts: '[]',
        vatRateSnapshot: 0, staffVatRateSnapshot: null, ...payment, remainingPaymentDate: '2026-10-20', updatedAt: now.toISOString(),
        assignments: [{ id: 1, eventId: 42, collaboratorId: 1, collaborator, role: 'Emp.Mesa', status: 'confirmed',
          assignmentDate: '2026-10-16', hourlyRate: 8, plannedCheckIn: '18:00', plannedCheckOut: '00:00',
          checkIn: '18:00', checkOut: '00:00', clientCheckIn: '18:00', clientCheckOut: '00:00', validationStatus: 'validated' }] };
      const recalculate = () => Object.assign(stored, calculateEventTotals(stored, stored.assignments)); recalculate();
      const originalPayment = Object.fromEntries(CLIENT_PAYMENT_FIELDS.map((field) => [field, stored[field]]));
      const writes = [];
      await page.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(4);
        if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
        if (request.method() === 'GET') return route.fulfill({ json: path === '/services' ? [stored]
          : path === '/services/42' ? stored : path === '/clients' ? [client] : path === '/collaborators/roles' ? ['Emp.Mesa']
            : path.startsWith('/collaborators') ? [collaborator] : path === '/settings' ? {} : [] });
        const payload = request.postDataJSON();
        if (path === '/services/42/workflow/synchronize') return route.fulfill({ json: stored });
        if (path === '/services/42' && request.method() === 'PUT') {
          writes.push(payload);
          try { assertClientSignalHistoryPreserved(payload, stored); }
          catch (error) { return route.fulfill({ status: error.statusCode, json: { message: error.message } }); }
          Object.assign(stored, normalizeEvent(payload));
        } else if (path === '/assignments/1' && request.method() === 'PUT') {
          Object.assign(stored.assignments[0], normalizeAssignment(payload));
        } else throw new Error(`Unexpected write ${request.method()} ${path}`);
        recalculate(); return route.fulfill({ json: path.startsWith('/assignments/') ? stored.assignments[0] : stored });
      });
      const open = async () => {
        await page.goto(`${base}/services?serviceId=42`);
        await page.getByRole('dialog').waitFor();
      };
      await open();
      const form = page.getByRole('dialog');
      await form.locator('.service-role-requirement-row').filter({ hasText: 'Emp.Mesa' }).getByPlaceholder('Ex: 14,00 €/h').fill('20,00');
      await form.getByRole('button', { name: 'Guardar', exact: true }).click();
      await form.waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(writes.length, 1);
      for (const field of CLIENT_PAYMENT_FIELDS) assert.equal(Object.hasOwn(writes[0], field), false, `price edit must not write ${field}`);
      assert.deepEqual(Object.fromEntries(CLIENT_PAYMENT_FIELDS.map((field) => [field, stored[field]])), originalPayment);
      assert.equal(JSON.parse(stored.requiredRoles)[0].agreedRate, 20);
      assert.equal(stored.totalRevenue, 120); assert.equal(stored.totalCost, 48);
      assert.equal(stored.assignments[0].hourlyRate, 8);
      await open();
      assert.match(await form.locator('.service-role-requirement-row').filter({ hasText: 'Emp.Mesa' }).getByPlaceholder('Ex: 14,00 €/h').inputValue(), /20,00/);
      await form.locator('.service-tabs').getByRole('button', { name: 'Financeiro', exact: true }).click();
      await form.getByRole('checkbox', { name: /Aplicar IVA/ }).check();
      await form.getByRole('button', { name: 'Guardar', exact: true }).click(); await form.waitFor({ state: 'detached' });
      assert.equal(stored.totalRevenue, 147.6);
      assert.deepEqual(Object.fromEntries(CLIENT_PAYMENT_FIELDS.map((field) => [field, stored[field]])), originalPayment);
      await context.close();
      console.log(`Price edit/reopen/VAT preserve ${payment.billingStatus} receipts (${payment.paidAmount}) at ${width}px.`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
