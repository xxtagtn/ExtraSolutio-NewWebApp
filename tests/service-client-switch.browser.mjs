// Client data and API writes are simulated; no real events are created.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decimalValue } from '../src/utils/serviceFinance.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const clients = [
  { id: 1, name: 'Cliente A QA', address: 'Rua A, Lisboa', representativeName: 'Responsavel A', phone: '111111111',
    minimumHours: 4, defaultUniform: 'Camisa Preta', billingMethod: 'monthly', paymentTerm: 'days_30', roleRates: [{ role: 'Emp.Mesa', rate: 10 }] },
  { id: 2, name: 'Cliente B QA', address: 'Rua B, Lisboa', representativeName: 'Responsavel B', phone: '222222222',
    minimumHours: 8, defaultUniform: 'Camisa Branca', billingMethod: 'per_event', paymentTerm: 'days_15', roleRates: [{ role: 'Emp.Mesa', rate: 16 }] },
  { id: 3, name: 'Cliente sem predefinicoes QA' },
];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'test-only',
      user: { id: 1, role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'client-switch-qa' })));
    const saved = [], errors = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      let body = [];
      if (path === '/clients') body = clients;
      else if (path === '/collaborators/roles') body = ['Emp.Mesa'];
      else if (path === '/services' && request.method() === 'POST') {
        body = { ...request.postDataJSON(), id: 42, assignments: [] }; saved.push(body);
      } else if (path === '/services') body = saved;
      else if (path === '/services/42/workflow/synchronize') body = saved[0];
      else if (path === '/notifications/overview') body = { notifications: { total: 0, items: [], allItems: [] }, reminders: [] };
      return route.fulfill({ json: body });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/services`);
    const open = page.getByRole('button', { name: 'Novo Evento/Serviço', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog'), client = dialog.getByLabel('Cliente registado (opcional)');
    const role = dialog.locator('.service-role-requirement-row').filter({ hasText: 'Emp.Mesa' });
    const rate = role.getByPlaceholder('Ex: 14,00 €/h');
    await dialog.getByLabel('Evento / Serviço', { exact: true }).fill('Troca de cliente QA');
    await dialog.getByLabel('Data', { exact: true }).fill('2026-11-20');
    await dialog.getByLabel('Entrada prevista', { exact: true }).fill('10:00');
    await dialog.getByLabel('Saída prevista', { exact: true }).fill('12:00');
    await client.selectOption('1');
    await role.getByPlaceholder('Ex: 4').fill('2');
    assert.equal(decimalValue(await rate.inputValue()), 10);
    assert.equal(await dialog.getByLabel('Contacto no Local - Nome').inputValue(), 'Responsavel A');
    await client.selectOption('2');
    assert.equal(decimalValue(await rate.inputValue()), 16);
    assert.equal(await dialog.getByLabel('Contacto no Local - Nome').inputValue(), 'Responsavel B');
    assert.equal(await dialog.getByLabel('Contacto no Local - Telefone').inputValue(), '222222222');
    assert.equal(await dialog.locator('.service-uniform-row select').inputValue(), 'Camisa Branca');
    assert.equal(await dialog.getByPlaceholder('Ex: Centro de Congressos de Lisboa').inputValue(), 'Rua B, Lisboa');
    assert.match(await dialog.locator('.client-info-grid').innerText(), /8 h por colaborador/);
    assert.equal(saved.length, 0);
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(saved[0].clientId, 2); assert.equal(saved[0].minimumHoursSnapshot, 8);
    assert.equal(saved[0].totalRevenue, 256); assert.equal(decimalValue(saved[0].requiredRoles[0].agreedRate), 16);
    assert.equal(saved[0].onsiteContactName, 'Responsavel B');
    await open.click();
    await client.selectOption('1');
    await role.getByPlaceholder('Ex: 4').fill('2');
    await rate.fill('19'); await rate.blur();
    await dialog.getByLabel('Contacto no Local - Nome').fill('Responsavel personalizado');
    await dialog.locator('.service-uniform-row select').selectOption('Outros');
    await dialog.getByLabel('Tipo de uniforme').fill('Uniforme personalizado');
    await dialog.getByRole('checkbox', { name: 'Utilizar local habitual' }).uncheck();
    await dialog.getByPlaceholder('Ex: Centro de Congressos de Lisboa').fill('Local personalizado');
    await client.selectOption('2');
    assert.match(await rate.inputValue(), /19,00/);
    assert.equal(await role.locator('.source-badge').count(), 0, 'A custom rate must not be labelled as inherited');
    assert.equal(await dialog.getByLabel('Contacto no Local - Nome').inputValue(), 'Responsavel personalizado');
    assert.equal(await dialog.getByLabel('Contacto no Local - Telefone').inputValue(), '222222222');
    assert.equal(await dialog.getByLabel('Tipo de uniforme').inputValue(), 'Uniforme personalizado');
    assert.equal(await dialog.getByPlaceholder('Ex: Centro de Congressos de Lisboa').inputValue(), 'Local personalizado');
    await client.selectOption('3');
    assert.equal(await dialog.getByLabel('Contacto no Local - Telefone').inputValue(), '');
    assert.equal(await dialog.getByLabel('Contacto no Local - Nome').inputValue(), 'Responsavel personalizado');
    assert.equal(saved.length, 1);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Client A -> B updates inherited data/pricing; custom values and saved client are correct at ${width}px`);
  }
} finally { await browser.close(); }
