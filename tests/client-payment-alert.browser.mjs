// Read-only fixture requests: no database, real payments or production API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
const output = 'node_modules/.cache/client-payment-alert';
await mkdir(output, { recursive: true });
const now = new Date('2026-10-17T12:00:00Z');
const cases = [
  { name: 'Immediate unpaid QA', alert: true, method: 'per_event', term: 'immediate' },
  { name: 'Ordinary agreed date QA', alert: false, method: 'per_event', term: 'immediate', remaining: '2026-10-20' },
  { name: 'SSH monthly unbilled QA', alert: false, method: 'monthly', term: 'days_30' },
  { name: 'SSH invoice within term QA', alert: false, method: 'monthly', term: 'days_30', issue: '2026-10-01' },
  { name: 'SSH overdue invoice QA', alert: true, method: 'monthly', term: 'days_30', issue: '2026-09-01' },
  { name: 'SSH due today QA', alert: false, method: 'monthly', term: 'days_30', issue: '2026-09-17' },
  { name: 'Biweekly within term QA', alert: false, method: 'biweekly', term: 'days_15', issue: '2026-10-10' },
  { name: 'Custom overdue QA', alert: true, method: 'custom', term: 'custom', days: 12, issue: '2026-10-01' },
  { name: 'Prepayment within term QA', alert: false, method: 'prepaid', term: 'immediate', date: '2026-10-24' },
  { name: 'Hours adjustment QA', alert: true, method: 'per_event', term: 'immediate', adjustment: true },
  { name: 'FIC invoiced layout QA', alert: false, method: 'per_event', term: 'days_30', layout: true },
  { name: 'FIC manual invoice overdue QA', alert: true, method: 'biweekly', term: 'immediate', manualIssue: '2026-10-15', deadline: 'Vencida há 2 dias' },
  { name: 'FIC manual invoice within term QA', alert: false, method: 'biweekly', term: 'days_15', manualIssue: '2026-10-15', deadline: 'Dentro do prazo' },
  { name: 'SSH manual invoice within term QA', alert: false, method: 'monthly', term: 'days_30', manualIssue: '2026-10-15', deadline: 'Dentro do prazo' },
];
const clients = cases.map((item, index) => ({ id: index + 1, name: item.name, status: 'active',
  billingMethod: item.method, paymentTerm: item.term, paymentTermDays: item.days, prepaymentRemainingDaysBefore: 7 }));
const services = cases.map((item, index) => ({ id: index + 1, name: `Event ${item.name}`, clientId: index + 1, client: clients[index],
  date: item.date || '2026-10-10', status: 'finalized', statusMode: 'manual', requiredRoles: '[{"role":"Emp.Mesa","qty":1}]',
  totalRevenue: item.layout ? 295.2 : item.adjustment ? 1763.82 : 1000, taxAmount: item.layout ? 55.2 : item.adjustment ? 329.82 : 186.99, totalCost: 300,
  paidAmount: item.layout ? 0 : item.adjustment ? 1745.37 : 800, signaledAmount: item.layout ? 0 : 200, billingStatus: item.layout ? 'invoiced' : item.adjustment ? 'paid' : 'partial70',
  remainingPaymentDate: item.remaining || null, clientPaymentRecord: JSON.stringify({ version: 1, entries: [],
    ...(item.manualIssue ? { commercialStatus: 'invoiced', commercialIssueDate: item.manualIssue } : {}) }),
  assignments: [], externalCosts: '[]', workLocations: [], updatedAt: '2026-10-17T10:00:00.000Z' }));
const invoices = cases.flatMap((item, index) => item.issue ? [{ id: index + 1, eventId: index + 1, clientId: index + 1,
  client: clients[index], status: 'issued', issueDate: item.issue, dueDate: '2020-01-01', number: `QA-${index + 1}`, total: 1000 }] : []);
const original = structuredClone({ clients, services, invoices });
const errors = [], writes = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: 'Europe/Lisbon' });
    await context.addInitScript((timestamp) => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: timestamp, sessionId: 'payment-alert-qa',
    })), now.getTime());
    const page = await context.newPage(); await page.clock.install({ time: now });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      const path = url.pathname.slice(4);
      const body = path === '/services' ? services : path === '/clients' ? clients : path === '/invoices' ? invoices
        : /^\/services\/\d+$/.test(path) ? services.find((event) => event.id === Number(path.split('/').at(-1))) : [];
      return route.fulfill({ json: body });
    });
    await page.goto(`${base}/finance?area=clients`);
    const workspace = page.locator('.finance-client-workspace'); await workspace.waitFor();
    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index], service = services[index];
      await workspace.locator('.finance-client-summary-row').filter({ hasText: item.name }).click();
      const row = workspace.locator('.finance-client-event-row').filter({ hasText: service.name }); await row.waitFor();
      assert.equal(await row.getByText('Pagamento em falta', { exact: true }).count(), Number(item.alert), item.name);
      if (item.deadline) await row.locator('.finance-client-deadline').getByText(item.deadline, { exact: true }).waitFor();
      assert.equal(await row.locator('.finance-client-missing').count(), Number(item.alert), 'Only overdue balances receive warning styling');
      assert.match(await row.textContent(), item.layout ? /295,20/ : item.adjustment ? /18,45/ : /200,00/, 'Balance is retained, even when not overdue');
      assert.match(await row.locator('.finance-client-received').textContent(), item.layout ? /0,00/ : item.adjustment ? /1745,37/ : /800,00/);
      const contained = await row.locator('.finance-client-outstanding').evaluate((cell) => {
        const small = cell.querySelector('small'); if (!small) return { valid: true };
        const bounds = cell.getBoundingClientRect(), amount = cell.querySelector('strong').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(small);
        return { valid: small.getBoundingClientRect().top >= amount.bottom && [...range.getClientRects()].every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1),
          cell: bounds.toJSON(), amount: amount.toJSON(), small: small.getBoundingClientRect().toJSON(), rects: [...range.getClientRects()].map((rect) => rect.toJSON()) };
      });
      if (!contained.valid) await row.screenshot({ path: `${output}/overlap-${width}.png` });
      assert.equal(contained.valid, true, `${item.name}: base/VAT cannot overlap: ${JSON.stringify(contained)}`);
      await row.getByRole('button', { name: 'Gerir recebimentos', exact: true }).click();
      const manager = page.getByRole('dialog', { name: 'Gerir recebimentos', exact: true }); await manager.waitFor();
      if (item.deadline) await manager.locator('.finance-receipt-dates').getByText(item.deadline, { exact: true }).waitFor();
      assert.equal(await manager.locator('.finance-receipt-balance').count(), Number(item.alert), `${item.name}: manager shares the same commercial alert rule`);
      assert.match(await manager.locator('[data-payment-metric="outstanding"] .payment-metric-gross').textContent(), item.layout ? /295,20/ : item.adjustment ? /18,45/ : /200,00/);
      if (item.name === 'SSH invoice within term QA' || item.adjustment || item.manualIssue) await manager.screenshot({ path: `${output}/manager-${index}-${width}.png` });
      await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
      if (item.name === 'SSH invoice within term QA' || item.adjustment || item.layout || item.manualIssue) await row.screenshot({ path: `${output}/row-${index}-${width}.png` });
    }
    await page.reload(); await workspace.waitFor();
    for (const name of ['SSH invoice within term QA', 'SSH overdue invoice QA', 'FIC manual invoice overdue QA', 'FIC manual invoice within term QA']) {
      await workspace.locator('.finance-client-summary-row').filter({ hasText: name }).click();
      const item = cases.find((entry) => entry.name === name);
      const row = workspace.locator('.finance-client-event-row').filter({ hasText: `Event ${name}` }); await row.waitFor();
      assert.equal(await row.getByText('Pagamento em falta', { exact: true }).count(), Number(item.alert), 'Reload keeps commercial timing consistent');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await context.close(); console.log(`Payment alerts: 14 commercial/layout scenarios, manual issue dates, unchanged balances, manager and reload passed at ${width}px.`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  assert.deepEqual({ clients, services, invoices }, original);
} finally { await browser.close(); }
