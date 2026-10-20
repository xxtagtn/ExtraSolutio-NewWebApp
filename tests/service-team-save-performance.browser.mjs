// Simulated API only; request counts measure redundant work, not production timings.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1440]) {
    const collaborators = Array.from({ length: 78 }, (_, i) => ({ id: i + 1, name: `Pessoa QA ${i + 1}`, roles: ['Emp.Mesa'], hourlyRate: 8, status: 'active' }));
    const days = Array.from({ length: 26 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const service = { id: 10, name: '78 alocacoes QA', date: days[0], endDate: days.at(-1), isContinuous: true,
      status: 'confirmed', startTime: '10:00', endTime: '18:00', totalRevenue: 9210.24, taxAmount: 1722.24,
      requiredRoles: days.map(day => ({ role: 'Emp.Mesa', qty: 3, agreedRate: 12, day })),
      assignments: collaborators.map((collaborator, i) => ({ id: i + 1, eventId: 10, collaboratorId: collaborator.id, collaborator,
        assignmentDate: days[Math.floor(i / 3)], role: 'Emp.Mesa', plannedCheckIn: '10:00', plannedCheckOut: '18:00', hourlyRate: 8,
        status: 'confirmed', clientSynced: true, checkIn: '10:00', checkOut: '18:00', validationStatus: 'validated', paymentStatus: 'paid',
        hoursWorked: 8, staffPayableHours: 8, clientRealHours: 0, clientBillableHours: 0, totalPay: 64, advancePayments: [] })) };
    const writes = [], errors = [], original = structuredClone(service);
    let fail = false;
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'test-only',
      user: { id: 1, role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'save-performance-qa' })));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      let body = [];
      if (request.method() !== 'GET') {
        const patch = request.postDataJSON(); writes.push({ path, method: request.method(), patch });
        if (path === '/services/10/workflow/synchronize') return route.fulfill({ json: service });
        if (path === '/services/10') {
          Object.assign(service, patch, { assignments: service.assignments });
          return route.fulfill({ json: service });
        }
        assert.match(path, /^\/assignments\/\d+$/);
        if (fail) return route.fulfill({ status: 422, json: { message: 'Erro de teste: alterações não guardadas.' } });
        body = service.assignments.find(row => row.id === Number(path.split('/').at(-1)));
        Object.assign(body, patch);
      } else if (path === '/services') body = [service];
      else if (path === '/services/10') body = service;
      else if (path === '/collaborators') body = collaborators;
      else if (path === '/notifications/overview') body = { notifications: { total: 0, items: [], allItems: [] }, reminders: [] };
      return route.fulfill({ json: body });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/services/10?tab=team`);
    const rows = page.locator('.service-detail-team-row'), save = page.getByRole('button', { name: 'Guardar alterações', exact: true }).last();
    await rows.first().waitFor();
    assert.equal(await rows.count(), 3);
    await save.click();
    await page.getByText('Sem alterações por guardar.', { exact: true }).waitFor();
    assert.equal(writes.length, 0);
    await rows.first().getByPlaceholder('Ex: 8,50').fill('9');
    await save.click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('A guardar...')));
    assert.deepEqual(writes, [{ path: '/assignments/1', method: 'PUT', patch: { hourlyRate: 9 } }]);
    assert.deepEqual(service.assignments.slice(1), original.assignments.slice(1));
    await page.locator('.service-detail-day-tabs button').filter({ hasText: '26/10' }).click();
    await rows.last().getByRole('checkbox').uncheck();
    await save.click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('A guardar...')));
    assert.deepEqual(writes.at(-1), { path: '/assignments/78', method: 'PUT', patch: { clientSynced: false } });
    assert.equal(writes.length, 2);
    fail = true;
    await rows.last().getByPlaceholder('Ex: 8,50').fill('10');
    await save.click();
    await page.getByText('Erro de teste: alterações não guardadas.', { exact: true }).waitFor();
    assert.equal(await rows.last().getByPlaceholder('Ex: 8,50').inputValue(), '10');
    assert.equal(service.assignments[77].hourlyRate, 8);
    fail = false;
    await save.click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('A guardar...')));
    assert.equal(service.assignments[77].hourlyRate, 10);
    assert.equal(service.assignments[77].paymentStatus, 'paid');
    assert.equal(service.assignments[77].checkIn, '10:00');
    assert.equal(service.totalRevenue, original.totalRevenue); assert.equal(service.taxAmount, original.taxAmount);
    await page.reload();
    await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    await page.locator('.service-detail-day-tabs button').filter({ hasText: '26/10' }).click();
    assert.equal(await rows.last().getByPlaceholder('Ex: 8,50').inputValue(), '10');
    const count = writes.length;
    await save.click();
    await page.getByText('Sem alterações por guardar.', { exact: true }).waitFor();
    assert.equal(writes.length, count);
    // A fresh original fixture also exercises the separate Editar dados modal.
    Object.assign(service, structuredClone(original));
    writes.length = 0;
    await page.goto(`${base}/services?serviceId=10`);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Evento / Serviço', { exact: true }).fill('78 alocacoes QA atualizado');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(writes.filter(write => write.path.startsWith('/assignments')).length, 0, 'Changing only event data must not rewrite 78 assignments');
    assert.equal(writes.filter(write => write.path === '/services/10').length, 1);
    assert.equal(service.assignments.length, 78);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`78 allocations / 26 days: no-op=0 writes, single-row edit=1 write, failure/retry and reload passed at ${width}px`);
  }
} finally { await browser.close(); }
