// Mocked API, using the existing storage normalizers. No real records or notifications.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeAssignment, normalizeEvent } from '../server/routes/crud.js';
import { buildEventAttendanceRows } from '../src/utils/eventAttendanceExcel.js';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const baseUrl = process.argv[4] || 'http://127.0.0.1:5175';
const days = ['2030-10-10', '2030-10-11', '2030-10-12', '2030-10-13'];
const client = { id: 3, name: 'Cliente QA', minimumHours: 4, billingMethod: 'per_event', roleRates: [{ role: 'Emp.Mesa', rate: 14 }] };
const collaborators = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, name: `Pessoa QA ${index + 1}`, nif: String(100000000 + index), roles: ['Emp.Mesa'], hourlyRate: 9, status: 'active' }));
const fullDays = Array.from({ length: 16 }, (_, index) => `2030-10-${String(index + 10).padStart(2, '0')}`);
const cases = [
  { name: 'all-days', kept: days },
  { name: 'remove-last-day', kept: days.slice(0, 3), end: days[2] },
  { name: 'remove-first-and-last', kept: [days[2]], start: days[2], end: days[2] },
  { name: 'copy-after-trimming', kept: days.slice(2), start: days[2], copyAfter: true },
  { name: 'cancelled-interleaved-source', kept: [days[0], days[2]], cancelledDays: [days[1], days[3]] },
  { name: 'single-day', kept: [days[0]], single: true },
  { name: 'preserve-edited-team-15-to-25', days: fullDays, kept: fullDays.slice(5), start: '2030-10-15', roundTrip: true },
  { name: 'round-trip-without-team', kept: days, roundTrip: true, withoutTeam: true },
  { name: 'renamed-location', kept: days, renameLocation: true },
  { name: 'removed-location', kept: days, removeLocation: true },
];
await mkdir('node_modules/.cache/service-duplication-days', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.argv[3] || undefined });
try {
  for (const [viewportName, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const scenario of cases) {
      const sourceDays = scenario.days || (scenario.single ? days.slice(0, 1) : days);
      const original = {
        id: 12, name: 'Original varios dias QA', clientId: 3, client, date: sourceDays[0], endDate: scenario.single ? null : sourceDays.at(-1),
        isContinuous: !scenario.single, startTime: '08:00', endTime: '18:00', status: 'finalized', statusMode: 'manual',
        billingStatus: 'paid', paidAmount: 1000, totalRevenue: 1000, totalCost: 500,
        cancelledDays: scenario.cancelledDays || [],
        workLocationsEnabled: true,
        workLocations: [20, 21, 22].map((id, index) => ({ id, eventId: 12, name: `Lounge ${index + 1}`, sortOrder: index })),
        requiredRoles: sourceDays.map((day) => ({ role: 'Emp.Mesa', qty: 3, agreedRate: 14, day })),
        assignments: sourceDays.flatMap((day, dayIndex) => [0, 1].map((index) => ({
          id: dayIndex * 10 + index + 1, eventId: 12, collaboratorId: dayIndex * 2 + index + 1,
          collaborator: collaborators[dayIndex * 2 + index], role: 'Emp.Mesa', assignmentDate: day,
          status: 'confirmed', plannedCheckIn: `${String(8 + dayIndex).padStart(2, '0')}:00`, plannedCheckOut: day === '2030-10-20' ? '19:00' : '18:00',
          workLocationId: 20 + (dayIndex + index) % 3,
          checkIn: `${String(8 + dayIndex).padStart(2, '0')}:00`, checkOut: '18:00', validationStatus: 'validated',
          hoursWorked: Math.max(1, 8 - dayIndex), totalPay: 100, hourlyRate: 8, paymentStatus: 'paid',
        }))),
        assignmentDrafts: sourceDays.map((day, index) => ({ draftId: `original-${index}`, role: 'Emp.Mesa', assignmentDate: day, plannedCheckIn: `${String(8 + index).padStart(2, '0')}:00`, plannedCheckOut: '18:00' })),
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
          const payload = request.postDataJSON();
          body = { ...normalizeEvent(payload), id: 100, assignments: [], client,
            workLocations: (payload.workLocations || []).map((name, index) => ({ id: 700 + index, eventId: 100, name, sortOrder: index })).reverse() };
          stored.push(body);
        } else if (path === '/assignments' && request.method() === 'POST') {
          body = { ...normalizeAssignment(request.postDataJSON()), id: 900 + writes.length };
          body.workLocation = stored[0].workLocations.find((location) => location.id === body.workLocationId) || null;
          stored[0].assignments.push(body);
        } else if (/^\/assignments\/\d+$/.test(path) && request.method() === 'PUT') {
          body = stored[0].assignments.find((row) => row.id === Number(path.split('/').at(-1)));
          Object.assign(body, normalizeAssignment(request.postDataJSON()));
          body.workLocation = stored[0].workLocations.find((location) => location.id === body.workLocationId) || null;
        } else if (path === '/services/100' && request.method() === 'PUT') {
          const payload = request.postDataJSON();
          const normalized = normalizeEvent(payload);
          for (const key of Object.keys(payload)) if (key in normalized) stored[0][key] = normalized[key];
          body = stored[0];
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
      if (!scenario.copyAfter && !scenario.withoutTeam) await copyTeam.check();
      if (scenario.start) await dialog.getByLabel('Data de início', { exact: true }).fill(scenario.start);
      if (!scenario.single) assert.equal(await dialog.getByLabel('Data de fim', { exact: true }).inputValue(), sourceDays.at(-1), 'editing start does not change end');
      if (scenario.end) await dialog.getByLabel('Data de fim', { exact: true }).fill(scenario.end);
      if (scenario.copyAfter) await copyTeam.check();
      // Recopy repeatedly: the final draft must still contain each original slot once.
      if (!scenario.withoutTeam) for (let repeat = 0; repeat < 2; repeat += 1) { await copyTeam.uncheck(); await copyTeam.check(); }
      if (scenario.renameLocation) await dialog.getByLabel('Local de Trabalho 1', { exact: true }).fill('Lounge VIP');
      if (scenario.removeLocation) await dialog.getByRole('button', { name: 'Remover local 2', exact: true }).click();
      await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      const editedDay = scenario.days ? '2030-10-20' : null;
      if (editedDay) {
        await dialog.locator('.service-day-tabs').getByRole('button', { name: '20/10/2030', exact: true }).click();
        await dialog.getByLabel('Entrada prevista', { exact: true }).first().fill('20:30');
        await dialog.locator('.service-assignment-row input[placeholder="Valor/h acordado"]').first().focus();
        await dialog.locator('.service-assignment-row input[placeholder="Valor/h acordado"]').first().fill('12,50');
        await dialog.locator('.service-assignment-row input[placeholder="Valor/h acordado"]').first().press('Tab');
        await dialog.locator('.service-assignment-row select').first().selectOption('confirmed');
        assert.equal(await dialog.getByLabel('Entrada prevista', { exact: true }).first().inputValue(), '20:30', 'manual schedule must be accepted before testing preservation');
        assert.equal(await dialog.locator('.service-assignment-row input[placeholder="Valor/h acordado"]').first().inputValue(), '12,50€');
      }
      if (scenario.roundTrip) {
        await dialog.getByRole('button', { name: 'Evento/Serviço', exact: true }).click();
        const finalEnd = sourceDays.at(-1);
        for (let repeat = 0; repeat < 3; repeat += 1) {
          await dialog.getByLabel('Data de fim', { exact: true }).fill(scenario.start || sourceDays[0]);
          await dialog.getByLabel('Data de fim', { exact: true }).fill('');
          await dialog.getByLabel('Data de fim', { exact: true }).fill(finalEnd);
        }
        await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      }
      for (const day of scenario.kept) {
        if (!scenario.single) await dialog.locator('.service-day-tabs').getByRole('button', { name: day.split('-').reverse().join('/'), exact: true }).click();
        const expectedNames = original.assignments.filter((row) => row.assignmentDate === day).map((row) => row.collaborator.name);
        const labels = await dialog.locator('.service-collab-trigger').allTextContents();
        assert.equal(labels.length, 3, `${scenario.name}: two collaborators plus one planned empty slot per retained day`);
        if (!scenario.withoutTeam) for (const name of expectedNames) assert.ok(labels.some((label) => label.includes(`${name} |`)), `${scenario.name}: correct team for ${day}`);
        if (scenario.withoutTeam) assert.ok(labels.every((label) => label === 'Por atribuir'));
        assert.ok(labels.includes('Por atribuir'));
        for (const [index, input] of (await dialog.getByLabel('Entrada prevista', { exact: true }).all()).entries()) {
          assert.equal(await input.inputValue(), day === editedDay && index === 0 ? '20:30' : original.assignments.find((row) => row.assignmentDate === day).plannedCheckIn, 'planned time and manual edits stay with their date');
        }
        if (day === editedDay) {
          assert.equal(await dialog.locator('.service-assignment-row input[placeholder="Valor/h acordado"]').first().inputValue(), '12,50€');
          assert.equal(await dialog.locator('.service-assignment-row select').first().inputValue(), 'confirmed');
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
      if (!scenario.single) {
        assert.equal(await dialog.getByLabel('Data de fim', { exact: true }).inputValue(), scenario.end || sourceDays.at(-1), 'start beyond end leaves end unchanged until explicitly edited');
        await dialog.getByLabel('Data de fim', { exact: true }).fill(shiftedDay(scenario.end || sourceDays.at(-1)));
      }
      if (!scenario.roundTrip && !scenario.withoutTeam) { await copyTeam.uncheck(); await copyTeam.check(); }
      await dialog.getByLabel('Evento / Serviço', { exact: true }).fill(`Novo ${scenario.name}`);
      await dialog.getByRole('button', { name: 'Colaboradores', exact: true }).click();
      await page.screenshot({ path: `node_modules/.cache/service-duplication-days/${viewportName}-${scenario.name}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await dialog.getByRole('button', { name: 'Guardar novo evento', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(stored.length, 1);
      assert.equal(stored[0].assignments.length, scenario.withoutTeam ? 0 : scenario.kept.length * 2);
      const eventPayload = writes.find((write) => write.path === '/services' && write.method === 'POST').body;
      assert.deepEqual(eventPayload.requiredRoles.map((row) => row.day), retainedDates);
      assert.deepEqual(eventPayload.assignmentDrafts.map((row) => row.assignmentDate), scenario.withoutTeam ? retainedDates.flatMap((day) => [day, day, day]) : retainedDates);
      const assignmentPayloads = writes.filter((write) => write.path === '/assignments').map((write) => write.body);
      assert.deepEqual(assignmentPayloads.map((row) => [row.assignmentDate, row.collaboratorId]),
        original.assignments.filter((row) => !scenario.withoutTeam && scenario.kept.includes(row.assignmentDate))
          .map((row) => [scenario.single ? null : shiftedDay(row.assignmentDate), row.collaboratorId]));
      for (const row of assignmentPayloads) {
        const sourceRow = original.assignments.find((assignment) => assignment.collaboratorId === row.collaboratorId);
        const sourceLocation = original.workLocations.find((location) => location.id === sourceRow.workLocationId);
        const expectedName = scenario.renameLocation && sourceLocation.id === 20 ? 'Lounge VIP' : sourceLocation.name;
        const savedLocation = stored[0].workLocations.find((location) => location.name === expectedName);
        assert.equal(row.workLocationId, savedLocation?.id || null, 'each day/team association uses its actual new location ID, including rename/removal');
        assert.ok(!original.workLocations.some((location) => location.id === row.workLocationId));
        const editedId = editedDay ? original.assignments.find((assignment) => assignment.assignmentDate === editedDay).collaboratorId : null;
        assert.equal(row.status, row.collaboratorId === editedId ? 'confirmed' : 'pending_confirmation');
        if (row.collaboratorId === editedId) {
          assert.equal(row.plannedCheckIn, '20:30');
          assert.equal(row.hourlyRate, 12.5);
        }
        assert.equal(row.checkIn, null);
        assert.equal(row.checkOut, null);
        assert.equal(row.hoursWorked, 0);
        assert.equal(row.totalPay, 0);
      }
      assert.ok(writes.every((write) => write.method === 'POST' && ['/services', '/assignments', '/services/100/workflow/synchronize'].includes(write.path)), 'only the new event is created/synchronized; no updates or deletes to original records');
      assert.deepEqual(original, snapshot);
      if (!scenario.withoutTeam) for (const day of retainedDates) {
        const exported = buildEventAttendanceRows({ assignments: stored[0].assignments,
          collaborators, workLocations: stored[0].workLocations, selectedDay: day, isContinuous: !scenario.single });
        assert.equal(exported.length, 2);
        for (const row of exported) {
          const sourceRow = original.assignments.find((assignment) => assignment.collaborator.name === row.collaborator);
          const sourceLocation = original.workLocations.find((location) => location.id === sourceRow.workLocationId);
          assert.equal(row.workLocation, scenario.removeLocation && sourceLocation.id === 21 ? ''
            : scenario.renameLocation && sourceLocation.id === 20 ? 'Lounge VIP' : sourceLocation.name);
        }
      }

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
      if (scenario.name === 'all-days' || scenario.single) {
        await page.goto(`${baseUrl}/services/100`);
        await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
        const firstAssignment = stored[0].assignments[0];
        const firstPerson = collaborators.find((person) => person.id === firstAssignment.collaboratorId);
        const editableRow = page.locator('.service-detail-team-row').filter({ hasText: firstPerson.name });
        const locationSelect = editableRow.locator('.service-detail-work-location-field select');
        await locationSelect.waitFor();
        assert.equal(await locationSelect.inputValue(), String(firstAssignment.workLocationId), 'detail shows the copied location, not unassigned');
        const nextLocation = stored[0].workLocations.find((location) => location.id !== firstAssignment.workLocationId);
        await locationSelect.selectOption(String(nextLocation.id));
        const savedTeam = page.waitForResponse((response) => response.url().endsWith('/api/services/100') && response.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Guardar alterações', exact: true }).first().click();
        await savedTeam;
        assert.equal(firstAssignment.workLocationId, nextLocation.id);
        await page.reload();
        await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
        assert.equal(await locationSelect.inputValue(), String(nextLocation.id), 'editing duplicate location persists after reload');
        assert.deepEqual(original, snapshot);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(original, snapshot);
      console.log(`PASS ${viewportName} ${scenario.name}: exact day/team mapping, repeated copy, normalized save/reopen, original unchanged`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
