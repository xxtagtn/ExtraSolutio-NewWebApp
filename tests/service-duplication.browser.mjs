// All API requests are mocked: no database, notifications or real links are used.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { normalizeAssignment, normalizeEvent } from '../server/routes/crud.js';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const baseUrl = process.argv[4] || 'http://localhost:5175';
const browser = await chromium.launch({ headless: true, channel: process.argv[3] || undefined });
const client = { id: 3, name: 'Cliente QA', address: 'Morada atual', minimumHours: 4, roleRates: [{ role: 'Emp.Mesa', rate: 14 }], billingMethod: 'per_event' };
const collaborator = { id: 6, name: 'Ana QA', hourlyRate: 10, status: 'active', roles: ['Emp.Mesa'] };
const original = {
  id: 12, name: 'Evento original QA', serviceReference: 'ORIGINAL-12', clientId: 3, client,
  eventType: 'Catering', date: '2030-10-01', endDate: '2030-10-02', isContinuous: true,
  startTime: '18:00', endTime: '04:00', status: 'finalized', statusMode: 'manual',
  billingStatus: 'paid', signaledAmount: 100, paidAmount: 400, totalRevenue: 400,
  taxAmount: 80, vatRateSnapshot: 23, totalCost: 250, minimumHoursSnapshot: 8,
  useDefaultLocation: false, location: 'Local original QA', description: 'Notas QA',
  uniform: 'Camisa Branca', workLocationsEnabled: true,
  workLocations: [{ id: 20, eventId: 12, name: 'Sala', sortOrder: 0 }],
  requiredRoles: [
    { role: 'Emp.Mesa', day: '2030-10-01', qty: 1, agreedRate: 14 },
    { role: 'Emp.Mesa', day: '2030-10-02', qty: 1, agreedRate: 14 },
  ],
  assignmentDrafts: [], externalCosts: [{ id: 'old-cost', description: 'Custo antigo', amount: 100 }],
  assignments: [1, 2].map((day) => ({
    id: 40 + day, eventId: 12, collaboratorId: 6, collaborator, role: 'Emp.Mesa',
    assignmentDate: `2030-10-0${day}`, status: 'confirmed', hourlyRate: 8,
    plannedCheckIn: '18:00', plannedCheckOut: '04:00', checkIn: '18:00', checkOut: '04:00',
    clientCheckIn: '18:00', clientCheckOut: '04:00', validatedCheckIn: '18:00', validatedCheckOut: '04:00',
    validationStatus: 'validated', clientSynced: true, hoursWorked: 10, staffPayableHours: 10,
    clientBillableHours: 10, paymentStatus: 'paid', paymentAdjustment: 10,
    workLocationId: 20, advancePayments: [{ id: 'old-advance', amount: 20, date: '2030-10-01' }],
  })),
};

await mkdir('node_modules/.cache/service-duplication', { recursive: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['compact', { width: 320, height: 780 }]]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'test-only', user: { id: 1, name: 'Admin QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'duplicate-qa',
    })));
    const writes = [];
    const created = [];
    const errors = [];
    let failCreate = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) {
        if (url.origin !== new URL(baseUrl).origin) return route.abort();
        return route.continue();
      }
      const path = url.pathname.slice(4);
      let body = [];
      if (request.method() !== 'GET') writes.push({ path, method: request.method(), body: request.postDataJSON() });
      if (path === '/services' && request.method() === 'POST') {
        if (failCreate) {
          failCreate = false;
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Falha QA controlada' }) });
        }
        const payload = request.postDataJSON();
        body = { ...normalizeEvent(payload), id: 100 + created.length, assignments: [],
          workLocations: (payload.workLocations || []).map((name, index) => ({ id: 200 + created.length * 10 + index, eventId: 100 + created.length, name })) };
        created.push(body);
      } else if (path === '/assignments' && request.method() === 'POST') {
        body = { ...normalizeAssignment(request.postDataJSON()), id: 900 + writes.length };
        created.find((event) => event.id === body.eventId).assignments.push(body);
      } else if (/^\/services\/\d+$/.test(path) && request.method() === 'PUT') {
        body = created.find((event) => event.id === Number(path.split('/').at(-1)));
        assert.ok(body, 'updates must target newly created events, not the original');
        const payload = request.postDataJSON();
        const normalized = normalizeEvent(payload);
        for (const key of Object.keys(payload)) if (key in normalized) body[key] = normalized[key];
      } else if (path === '/services') body = [original, ...created];
      else if (path === '/services/12') body = original;
      else if (path === '/clients') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        body = [client];
      }
      else if (path === '/collaborators') body = [collaborator];
      else if (path === '/collaborators/roles') body = ['Emp.Mesa'];
      else if (path === '/service-templates') body = [{ id: 8, name: 'Template QA', payload: {
        isContinuous: true, startTime: '09:00', endTime: '17:00',
        requiredRoles: [{ role: 'Emp.Mesa', qty: 1, agreedRate: 14 }],
      } }];
      else if (path === '/settings') body = {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto(`${baseUrl}/services/12`);
    await page.getByRole('link', { name: 'Duplicar evento', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Evento / Serviço', { exact: true }).inputValue(), 'Cópia de Evento original QA');
    assert.equal(writes.length, 0, 'opening the copy must not write anything');
    assert.equal(await dialog.getByRole('button', { name: 'Eliminar', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(created.length, 0);
    assert.equal(writes.length, 0, 'cancelling must not write anything');

    await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
    dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Evento / Serviço', { exact: true }).fill('Novo evento sem equipa');
    await dialog.getByLabel('Data de início', { exact: true }).fill('');
    await dialog.getByLabel('Data de início', { exact: true }).fill('2030-11-01');
    assert.equal(await dialog.getByLabel('Data de fim', { exact: true }).inputValue(), '2030-10-02', 'editing start must not overwrite end');
    await dialog.getByLabel('Data de fim', { exact: true }).fill('2030-11-02');
    await page.screenshot({ path: `node_modules/.cache/service-duplication/${name}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: page must not overflow horizontally`);
    await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(created.length, 1);
    assert.equal(created[0].assignments.length, 0, 'team must not be copied by default');
    const noTeamPayload = writes.find((write) => write.path === '/services' && write.method === 'POST').body;
    assert.equal(noTeamPayload.billingStatus, 'pending');
    assert.equal(noTeamPayload.paidAmount, 0);
    assert.equal(noTeamPayload.signaledAmount, 0);
    assert.deepEqual(noTeamPayload.externalCosts, []);
    assert.equal(noTeamPayload.serviceReference, null);
    assert.deepEqual(noTeamPayload.workLocations, ['Sala']);
    assert.equal(noTeamPayload.minimumHoursSnapshot, 4, 'new event must use current client minimum');
    assert.deepEqual(noTeamPayload.assignmentDrafts.map((draft) => draft.assignmentDate), ['2030-11-01', '2030-11-02']);
    assert.deepEqual(JSON.parse(created[0].requiredRoles).map((role) => role.day), ['2030-11-01', '2030-11-02']);

    await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
    dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Copiar equipa do evento original (a aguardar confirmação)', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    await dialog.locator('.service-collab-trigger').filter({ hasText: 'Ana QA' }).waitFor();
    assert.equal(await dialog.locator('.service-assignment-row select').last().inputValue(), 'pending_confirmation');
    await dialog.getByRole('button', { name: 'Evento/Serviço', exact: true }).click();
    await dialog.getByLabel('Evento / Serviço', { exact: true }).fill('Novo evento com equipa');
    await dialog.getByLabel('Data de início', { exact: true }).fill('2030-12-01');
    await dialog.getByLabel('Data de fim', { exact: true }).fill('2030-12-02');
    failCreate = true;
    await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
    await dialog.getByText('Falha QA controlada', { exact: true }).waitFor();
    assert.equal(created.length, 1, 'failed POST must leave the original and drafts untouched');
    await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(created.length, 2);
    assert.equal(created[1].assignments.length, 2);
    for (const assignment of created[1].assignments) {
      assert.equal(assignment.collaboratorId, 6);
      assert.equal(assignment.eventId, created[1].id);
      assert.equal(assignment.status, 'pending_confirmation');
      assert.equal(assignment.validationStatus, 'pending');
      assert.equal(assignment.hoursWorked, 0);
      assert.equal(assignment.totalPay, 0);
      assert.equal(assignment.hourlyRate, 10, 'must not reuse a historical staff tariff');
      assert.equal(assignment.workLocationId, 210, 'copied association must use the new event location ID');
      assert.deepEqual(JSON.parse(assignment.advancePayments || '[]'), []);
      for (const field of ['checkIn', 'checkOut', 'clientCheckIn', 'clientCheckOut', 'validatedCheckIn', 'validatedCheckOut']) assert.equal(assignment[field], null);
      assert.equal(assignment.plannedCheckOut, '04:00');
    }
    assert.deepEqual(created[1].assignments.map((assignment) => new Date(assignment.assignmentDate).toISOString().slice(0, 10)), ['2030-12-01', '2030-12-02']);
    assert.equal(writes.some((write) => write.method === 'PUT' || write.method === 'DELETE'), false);
    assert.equal(original.name, 'Evento original QA');
    assert.equal(original.assignments[0].paymentStatus, 'paid');

    const writesBeforeTemplate = writes.length;
    await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
    dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Copiar equipa do evento original (a aguardar confirmação)', { exact: true }).check();
    await dialog.getByLabel('Data de fim', { exact: true }).fill('2030-10-01');
    await dialog.getByRole('button', { name: 'Selecionar template', exact: true }).click();
    await dialog.getByRole('button', { name: 'Template QA', exact: true }).click();
    await dialog.getByLabel('Data de fim', { exact: true }).fill('2030-10-02');
    await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    for (const day of ['01/10/2030', '02/10/2030']) {
      await dialog.locator('.service-day-tabs').getByRole('button', { name: day, exact: true }).click();
      assert.deepEqual(await dialog.locator('.service-collab-trigger').allTextContents(), [], 'template keeps its existing empty-team behavior and must not restore previously cached team');
    }
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.ok(writes.slice(writesBeforeTemplate).every((write) => write.method === 'POST'
      && /^\/services\/10[01]\/workflow\/synchronize$/.test(write.path)),
    `unsaved template must not write records; only existing saved event synchronization is allowed: ${JSON.stringify(writes.slice(writesBeforeTemplate).map(({ path, method }) => ({ path, method })))}`);

    // Existing inactive-staff protection turns copied rows into empty slots.
    // Those drafts must also receive the new location ID, never a draft key.
    collaborator.status = 'inactive';
    await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
    dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Copiar equipa do evento original (a aguardar confirmação)', { exact: true }).check();
    await dialog.getByLabel('Data de início', { exact: true }).fill('2031-01-01');
    await dialog.getByLabel('Data de fim', { exact: true }).fill('2031-01-02');
    await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(created.length, 3);
    assert.equal(created[2].assignments.length, 0, 'inactive staff must remain unassigned');
    assert.deepEqual(JSON.parse(created[2].assignmentDrafts).map((row) => [row.assignmentDate, row.workLocationId]),
      [['2031-01-01', '220'], ['2031-01-02', '220']]);
    assert.ok(!JSON.stringify(created[2]).includes('duplicate-location'));
    collaborator.status = 'active';

    client.billingMethod = 'prepaid';
    await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
    dialog = page.getByRole('dialog', { name: 'Novo evento a partir de Evento original QA', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Copiar equipa do evento original (a aguardar confirmação)', { exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: '+ Adicionar colaborador', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(created.length, 3, 'prepayment checks and cancellation do not create an event');
    client.billingMethod = 'per_event';

    await page.goto(`${baseUrl}/services`);
    await page.getByRole('button', { name: 'Novo Evento/Serviço', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Novo Evento/Serviço', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Evento / Serviço', { exact: true }).inputValue(), '');
    assert.equal(await dialog.locator('.service-duplicate-team').count(), 0);
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.goto(`${baseUrl}/services?serviceId=12`);
    dialog = page.getByRole('dialog', { name: original.name, exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.locator('.service-duplicate-team').count(), 0);
    await dialog.getByRole('button', { name: 'Financeiro', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Eliminar', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: no writes on open/cancel; new event only on save; optional pending team; independent dates; template reset; retry; prepayment; create/edit regression; no source changes`);
    await context.close();
  }
} finally {
  await browser.close();
}
