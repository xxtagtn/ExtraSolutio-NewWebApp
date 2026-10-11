// All API traffic is intercepted. Writes affect only the in-memory test fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175';
const output = 'node_modules/.cache/time-validation-mobile';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

function fixtures() {
  const collaborator = { id: 1, name: 'Aldair Higinio Antonio', status: 'active' };
  const assignment = (id, extra = {}) => ({ id, collaboratorId: 1, collaborator, role: 'Emp.Mesa',
    status: 'confirmed', paymentStatus: 'unpaid', hourlyRate: 8.5, assignmentDate: '2026-10-11',
    plannedCheckIn: '15:00', plannedCheckOut: '22:00', checkIn: '14:41', checkOut: null,
    validationStatus: 'pending', ...extra });
  const event = (id, name, assignments, extra = {}) => ({ id, name, date: '2026-10-11',
    status: 'in_execution', statusMode: 'manual', startTime: '15:00', endTime: '22:00',
    clientId: 1, client: { id: 1, name: 'SUPREME' }, workLocationsEnabled: true,
    workLocations: [{ id: 5, name: 'Lounge 1N' }], assignments, ...extra });
  return [
    event(10, 'JOGO SLB - VITORIA SC', [
      assignment(100, { eventId: 10, workLocationId: 5, workLocation: { id: 5, name: 'Lounge 1N' } }),
      assignment(101, { eventId: 10, collaboratorId: 2,
        collaborator: { id: 2, name: 'ColaboradorComUmNomeMuitoCompridoSemEspacosParaTestar' },
        workLocationId: 6, workLocation: { id: 6, name: 'Sala principal e zona de atendimento com nome comprido' },
        plannedCheckIn: '18:00', plannedCheckOut: '04:00', checkIn: null }),
    ]),
    event(20, 'Evento para conferir Cliente', [
      assignment(200, { eventId: 20, checkIn: '15:00', checkOut: '22:00', validationStatus: 'staff_accepted' }),
      assignment(201, { eventId: 20, checkIn: '15:00', checkOut: '22:00',
        clientCheckIn: '16:00', clientCheckOut: '21:00', validationStatus: 'pending' }),
    ]),
  ];
}

async function setup(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Lisbon' });
  await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
    token: 'test-only', user: { id: 1, name: 'Admin QA', role: 'admin' },
    lastActivityAt: Date.now(), sessionId: 'validation-mobile-test',
  })));
  const data = fixtures();
  const writes = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    const path = url.pathname.slice(4);
    let body = [];
    if (request.method() !== 'GET') {
      const payload = request.postDataJSON();
      writes.push({ path, method: request.method(), payload });
      assert.equal(request.method(), 'PUT');
      assert.match(path, /^\/assignments\/\d+$/);
      const assignment = data.flatMap((event) => event.assignments).find((row) => row.id === Number(path.split('/').at(-1)));
      assert.ok(assignment);
      Object.assign(assignment, payload);
      body = assignment;
    } else if (path === '/services') body = data;
    else if (path.startsWith('/collaborators')) body = data.flatMap((event) => event.assignments.map((row) => row.collaborator));
    else if (path === '/auth/me') body = { id: 1, name: 'Admin QA', role: 'admin' };
    await route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, writes };
}

async function inspect(page, mobile) {
  const result = await page.locator('.validation-table .validation-row').evaluateAll((rows) => rows.map((row) => {
    const bounds = row.getBoundingClientRect();
    const entry = row.querySelector('[aria-label="Entrada Staff"]').getBoundingClientRect();
    const exit = row.querySelector('[aria-label="Saída Staff"]').getBoundingClientRect();
    const clipped = [...row.querySelectorAll('input, button, strong, small, .validation-mobile-label')]
      .filter((element) => element.getBoundingClientRect().width && element.scrollWidth > element.clientWidth + 2)
      .map((element) => element.textContent || element.getAttribute('aria-label'));
    return { clipped, sameLine: Math.abs(entry.top - exit.top) < 2, inputWidth: entry.width,
      cardWidth: bounds.width, inputHeight: entry.height, display: getComputedStyle(row).display,
      mobileLabel: getComputedStyle(row.querySelector('.validation-mobile-label')).display };
  }));
  for (const row of result) {
    if (mobile) assert.deepEqual(row.clipped, []);
    assert.equal(row.sameLine, mobile);
    assert.equal(row.mobileLabel === 'none', !mobile);
    if (mobile) {
      assert.ok(row.inputWidth > row.cardWidth * 0.3, JSON.stringify(row));
      assert.ok(row.inputHeight >= 42);
      assert.equal(row.display, 'grid');
    } else assert.equal(row.display, 'table-row');
  }
  if (mobile) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
}

try {
  for (const width of [320, 360, 390, 430, 760, 1024, 1440]) {
    const f = await setup(width);
    const { page } = f;
    await page.goto(`${base}/time-validation?eventId=10`);
    const rows = page.locator('.validation-table .validation-row');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 2);
    const first = rows.first();
    assert.equal(await first.getByRole('textbox', { name: 'Entrada Staff', exact: true }).inputValue(), '14:41');
    assert.equal(await first.getByRole('button', { name: 'Aceitar', exact: true }).isDisabled(), true);
    await inspect(page, width <= 760);
    await first.screenshot({ path: `${output}/staff-card-${width}.png` });
    await page.screenshot({ path: `${output}/staff-page-${width}.png`, fullPage: true });
    if (width === 390 || width === 1440) {
      await first.getByRole('button', { name: 'Previsto', exact: true }).click();
      assert.equal(await first.getByRole('textbox', { name: 'Entrada Staff', exact: true }).inputValue(), '15:00');
      assert.equal(await first.getByRole('textbox', { name: 'Saída Staff', exact: true }).inputValue(), '22:00');
      await first.getByRole('textbox', { name: 'Saída Staff', exact: true }).fill('2230');
      const note = first.getByRole('textbox', { name: 'Notas de validação' });
      await note.fill('Nota QA');
      assert.equal(await first.getByRole('textbox', { name: 'Saída Staff', exact: true }).inputValue(), '22:30');
      await first.getByRole('button', { name: 'Guardar validação', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Guardar validação"]')?.disabled);
      assert.equal(f.writes.length, 1);
      assert.equal(f.writes[0].payload.checkIn, '15:00');
      assert.equal(f.writes[0].payload.checkOut, '22:30');
      assert.equal(f.writes[0].payload.hoursWorked, 7.5);
      assert.equal(f.writes[0].payload.totalPay, 63.75);
      assert.equal(f.writes[0].payload.validationNotes, 'Nota QA');
      await first.getByRole('button', { name: 'Aceitar', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.validation-stage-tab.is-active')].some((tab) => tab.textContent.includes('Por preencher Staff')));
      assert.equal(f.writes.length, 2);
      assert.equal(f.writes[1].payload.validationStatus, 'staff_accepted');
    }
    await page.goto(`${base}/time-validation?eventId=20`);
    await rows.first().waitFor();
    assert.equal(await rows.count(), 2);
    await inspect(page, width <= 760);
    await rows.first().screenshot({ path: `${output}/client-card-${width}.png` });
    if (width === 390 || width === 1440) {
      const client = rows.first();
      await client.getByRole('button', { name: 'Staff', exact: true }).click();
      assert.equal(await client.getByRole('textbox', { name: 'Entrada Cliente', exact: true }).inputValue(), '15:00');
      assert.equal(await client.getByRole('textbox', { name: 'Saída Cliente', exact: true }).inputValue(), '22:00');
      const before = f.writes.length;
      await client.getByRole('button', { name: 'Aceitar', exact: true }).click();
      await client.getByRole('button', { name: 'Reabrir validação', exact: true }).waitFor();
      assert.equal(f.writes.length, before + 1);
      assert.equal(f.writes.at(-1).payload.validationStatus, 'validated');
      assert.equal(f.writes.at(-1).payload.validatedCheckIn, '15:00');
      assert.equal(f.writes.at(-1).payload.validatedCheckOut, '22:00');
    }
    await f.context.close();
    console.log(`Validation cards, labels, overflow and ${width <= 760 ? 'mobile time pairs' : 'unchanged desktop stacks'} passed at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('Copy, note editing, save, staff acceptance and client validation passed with mocked writes only.');
} finally {
  await browser.close();
}
