// All API responses and writes are isolated from application data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { decimalValue } from '../src/utils/serviceFinance.js';
import { collaboratorRoleOptions } from '../src/utils/collaboratorRoles.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } });
const base = 'http://127.0.0.1:5198';
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [390, 1440]) {
    for (const catalogMode of ['partial', 'unavailable']) {
      const clients = [], writes = [], errors = [];
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
        token: 'test-only', user: { id: 1, name: 'QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'client-rates',
      })));
      await page.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return url.origin === base ? route.continue() : route.abort();
        const path = url.pathname.slice(4);
        let body = [];
        if (path === '/collaborators/roles') {
          if (catalogMode === 'unavailable') return route.fulfill({ status: 403, json: { message: 'Sem acesso ao catalogo.' } });
          // The client form must not rely on this response containing every standard role.
          body = ['Emp.Mesa', 'Funcao personalizada'];
        } else if (path === '/clients' && request.method() === 'POST') {
          body = { ...request.postDataJSON(), id: 1 }; clients.push(body); writes.push(body);
        } else if (path === '/clients/1' && request.method() === 'PUT') {
          body = { ...request.postDataJSON(), id: 1 }; clients[0] = body; writes.push(body);
        } else if (path === '/clients') body = clients;
        else if (request.method() !== 'GET') throw new Error('Unexpected write: ' + path);
        return route.fulfill({ json: body });
      });
      await page.goto(base + '/clients');
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const dialog = page.getByRole('dialog');
      for (const role of collaboratorRoleOptions) assert.equal(await dialog.getByLabel(role, { exact: true }).count(), 1);
      if (catalogMode === 'partial') assert.equal(await dialog.getByLabel('Funcao personalizada', { exact: true }).count(), 1);
      await dialog.getByLabel('Cliente / Parceiro', { exact: true }).fill('Cliente Cozinha QA');
      await dialog.getByLabel('Método de faturação').selectOption('monthly');
      await dialog.getByLabel('Prazo de pagamento').selectOption('days_15');
      await dialog.getByLabel('Cozinheiro', { exact: true }).fill('18,50');
      await dialog.getByLabel('Emp.Mesa', { exact: true }).fill('12');
      await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(writes.length, 1);
      assert.equal(decimalValue(clients[0].roleRates.find((rate) => rate.role === 'Cozinheiro').rate), 18.5);
      await page.reload();
      await page.locator('.collab-detail-card header').filter({ hasText: 'Cliente Cozinha QA' }).click();
      const savedRate = page.locator('.client-rates-table__row').filter({ hasText: 'Cozinheiro' });
      assert.match(await savedRate.innerText(), /18,50/);
      await page.getByRole('button', { name: 'Editar cliente', exact: true }).click();
      assert.equal(decimalValue(await dialog.getByLabel('Cozinheiro', { exact: true }).inputValue()), 18.5);
      await dialog.getByLabel('Cozinheiro', { exact: true }).fill('20');
      await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(writes.length, 2);
      assert.equal(decimalValue(clients[0].roleRates.find((rate) => rate.role === 'Cozinheiro').rate), 20);
      assert.equal(decimalValue(clients[0].roleRates.find((rate) => rate.role === 'Emp.Mesa').rate), 12);
      assert.equal(clients[0].roleRates.length, 2);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Client cook rate create/edit/reload, standard roles and other rates preserved: ${width}px, ${catalogMode}`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
