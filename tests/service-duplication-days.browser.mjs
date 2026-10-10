// Mocked API, using the existing storage normalizers. No real records or notifications.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeAssignment, normalizeEvent } from '../server/routes/crud.js';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const baseUrl = process.argv[4] || 'http://127.0.0.1:5175';
const days = ['2030-10-10', '2030-10-11', '2030-10-12', '2030-10-13'];
const client = { id: 3, name: 'Cliente QA', minimumHours: 4, billingMethod: 'per_event', roleRates: [{ role: 'Emp.Mesa', rate: 14 }] };
const collaborators = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `Pessoa QA ${index + 1}`, nif: String(100000000 + index), roles: ['Emp.Mesa'], hourlyRate: 9, status: 'active' }));
const cases = [
  { name: 'all-days', kept: days },
  { name: 'remove-last-day', kept: days.slice(0, 3), end: days[2] },
  { name: 'remove-first-and-last', kept: [days[2]], start: days[2], end: days[2] },
  { name: 'copy-after-trimming', kept: days.slice(2), start: days[2], copyAfter: true },
  { name: 'cancelled-interleaved-source', kept: [days[0], days[2]], cancelledDays: [days[1], days[3]] },
  { name: 'single-day', kept: [days[0]], single: true },
];
await mkdir('node_modules/.cache/service-duplication-days', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.argv[3] || undefined });
try {
  for (const [viewportName, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const scenario of cases) {
      const sourceDays = scenario.single ? days.slice(0, 1) : days;
      const original = {
        id: 12, name: 'Original varios dias QA', clientId: 3, client, date: days[0], endDate: scenario.single ? null : days.at(-1),
        isContinuous: !scenario.single, startTime: '08:00', endTime: '18:00', status: 'finalized', statusMode: 'manual',
        billingStatus: 'paid', paidAmount: 1000, totalRevenue: 1000, totalCost: 500,
        cancelledDays: scenario.cancelledDays || [],
        requiredRoles: sourceDays.map((day) => ({ role: 'Emp.Mesa', qty: 3, agreedRate: 14, day })),
        assignments: sourceDays.flatMap((day, dayIndex) => [0, 1].map((index) => ({
          id: dayIndex * 10 + index + 1, eventId: 12, collaboratorId: dayIndex * 2 + index + 1,
          collaborator: collaborators[dayIndex * 2 + index], role: 'Emp.Mesa', assignmentDate: day,
          status: 'confirmed', plannedCheckIn: `${10 + dayIndex}:00`, plannedCheckOut: '18:00',
          checkIn: `${10 + dayIndex}:00`, checkOut: '18:00', validationStatus: 'validated',
          hoursWorked: 8 - dayIndex, totalPay: 100, hourlyRate: 8, paymentStatus: 'paid',
        }))),
        assignmentDrafts: sourceDays.map((day, index) => ({ draftId: `original-${index}`, role: 'Emp.Mesa', assignmentDate: day, plannedCheckIn: `${10 + index}:00`, plannedCheckOut: '18:00' })),
      };
      const snapshot = structuredClone(original);
      const stored = [];
      const writes = [];
      const context = await browser.newContext({ viewport });
      await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
        token: 'test-only', user: { id: 1, name: 'Admin QA', role: 'admin' }, lastActivityAt: Date.now(), sessionId: 'duplicate-days-qa',
      })));
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
          body = { ...normalizeEvent(request.postDataJSON()), id: 100, assignments: [], client, workLocations: [] };
          stored.push(body);
        } else if (path === '/assignments' && request.method() === 'POST') {
          body = { ...normalizeAssignment(request.postDataJSON()), id: 900 + writes.length };
          stored[0].assignments.push(body);
        } else if (path === '/services') body = [original, ...stored];
        else if (path === '/services/12') body = original;
        else if (path === '/services/100') body = stored[0];
        else if (path === '/services/100/workflow/synchronize') body = stored[0];
        else if (path === '/clients') body = [client];
        else if (path === '/collaborators') body = collaborators;
        else if (path === '/collaborators/roles') body = ['Emp.Mesa'];
        else if (path === '/settings') body = {};
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
      await page.goto(`${baseUrl}/services?duplicateServiceId=12`);
      let dialog = page.getByRole('dialog', { name: `Novo evento a partir de ${original.name}`, exact: true });
      await dialog.waitFor();
      const copyTeam = dialog.getByLabel('Copiar equipa do evento original (a aguardar confirmação)', { exact: true });
      if (!scenario.copyAfter) await copyTeam.check();
      if (scenario.start) await dialog.getByLabel('Data de início', { exact: true }).fill(scenario.start);
      if (scenario.end) await dialog.getByLabel('Data de fim', { exact: true }).fill(scenario.end);
      if (scenario.copyAfter) await copyTeam.check();
      // Recopy repeatedly: the final draft must still contain each original slot once.
      for (let repeat = 0; repeat < 2; repeat += 1) { await copyTeam.uncheck(); await copyTeam.check(); }
      await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      for (const day of scenario.kept) {
        if (!scenario.single) await dialog.locator('.service-day-tabs').getByRole('button', { name: day.split('-').reverse().join('/'), exact: true }).click();
        const expectedNames = original.assignments.filter((row) => row.assignmentDate === day).map((row) => row.collaborator.name);
        const labels = await dialog.locator('.service-collab-trigger').allTextContents();
        assert.equal(labels.length, 3, `${scenario.name}: two collaborators plus one planned empty slot per retained day`);
        for (const name of expectedNames) assert.ok(labels.some((label) => label.includes(`${name} |`)), `${scenario.name}: correct team for ${day}`);
        assert.ok(labels.includes('Por atribuir'));
        for (const input of await dialog.getByLabel('Entrada prevista', { exact: true }).all()) {
          assert.equal(await input.inputValue(), `${10 + days.indexOf(day)}:00`, 'planned time stays with its date');
        }
      }
      if (scenario.start || scenario.end) {
        const tabLabels = await dialog.locator('.service-day-tabs button').allTextContents();
        assert.deepEqual(tabLabels, scenario.kept.map((day) => day.split('-').reverse().join('/')));
      }
      assert.equal(writes.length, 0, 'changing duplicate days must not write or modify the original');

      await dialog.getByRole('button', { name: 'Evento/Serviço', exact: true }).click();
      // Move to another month before saving, to respect the existing overlap protection.
      const oldStart = scenario.start || days[0];
      const newStart = '2030-11-01';
      const offset = Date.parse(`${newStart}T00:00:00Z`) - Date.parse(`${oldStart}T00:00:00Z`);
      const shiftedDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + offset).toISOString().slice(0, 10);
      const retainedDates = scenario.kept.map(shiftedDay);
      await dialog.getByLabel(scenario.single ? 'Data' : 'Data de início', { exact: true }).fill(newStart);
      await copyTeam.uncheck(); await copyTeam.check();
      await dialog.getByLabel('Evento / Serviço', { exact: true }).fill(`Novo ${scenario.name}`);
      await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      await page.screenshot({ path: `node_modules/.cache/service-duplication-days/${viewportName}-${scenario.name}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(stored.length, 1);
      assert.equal(stored[0].assignments.length, scenario.kept.length * 2);
      const eventPayload = writes.find((write) => write.path === '/services' && write.method === 'POST').body;
      assert.deepEqual(eventPayload.requiredRoles.map((row) => row.day), retainedDates);
      assert.deepEqual(eventPayload.assignmentDrafts.map((row) => row.assignmentDate), retainedDates);
      const assignmentPayloads = writes.filter((write) => write.path === '/assignments').map((write) => write.body);
      assert.deepEqual(assignmentPayloads.map((row) => [row.assignmentDate, row.collaboratorId]),
        original.assignments.filter((row) => scenario.kept.includes(row.assignmentDate))
          .map((row) => [scenario.single ? null : shiftedDay(row.assignmentDate), row.collaboratorId]));
      for (const row of assignmentPayloads) {
        assert.equal(row.status, 'pending_confirmation');
        assert.equal(row.checkIn, null);
        assert.equal(row.checkOut, null);
        assert.equal(row.hoursWorked, 0);
        assert.equal(row.totalPay, 0);
      }
      assert.ok(writes.every((write) => write.method === 'POST' && ['/services', '/assignments', '/services/100/workflow/synchronize'].includes(write.path)), 'only the new event is created/synchronized; no updates or deletes to original records');
      assert.deepEqual(original, snapshot);

      // Reload from normalized saved API data, rather than the in-memory creation form.
      await page.goto(`${baseUrl}/services?serviceId=100`);
      dialog = page.getByRole('dialog', { name: `Novo ${scenario.name}`, exact: true });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      for (const day of retainedDates) {
        if (!scenario.single) await dialog.locator('.service-day-tabs').getByRole('button', { name: day.split('-').reverse().join('/'), exact: true }).click();
        assert.equal(await dialog.locator('.service-collab-trigger').count(), 3, 'saved team and empty slots must remain consistent after reload');
      }
      if (scenario.start || scenario.end) assert.deepEqual(await dialog.locator('.service-day-tabs button').allTextContents(), retainedDates.map((day) => day.split('-').reverse().join('/')));
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.deepEqual(errors, []);
      assert.deepEqual(original, snapshot);
      console.log(`PASS ${viewportName} ${scenario.name}: exact day/team mapping, repeated copy, normalized save/reopen, original unchanged`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
