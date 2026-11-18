// All API responses are simulated; this test never edits a real event or records attendance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5186';
const output = 'node_modules/.cache/qr-uniform';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const client = { id: 1, name: 'Cliente QA', address: 'Lisboa', billingMethod: 'per_event', minimumHours: 0 };
    const event = { id: 41, name: 'Restaurante Luz Chakall', client, clientId: 1, date: '2026-11-18',
      eventType: 'Restaurante', startTime: '11:00', endTime: '16:00', location: 'Estádio da Luz',
      uniform: 'Camisa Branca', status: 'confirmed', statusMode: 'manual', assignments: [], requiredRoles: [],
      uniformNotes: '', externalCosts: [] };
    const context = await browser.newContext({ viewport: { width, height: 1100 }, serviceWorkers: 'block', timezoneId: 'Europe/Lisbon' });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({
      token: 'uniform-browser-test-only', user: { id: 1, role: 'admin', name: 'QA' }, sessionId: 'uniform-qa', lastActivityAt: Date.now(),
    })));
    const writes = [];
    const service = () => ({
      assignmentId: 1, assignmentDate: '2026-11-18', eventName: event.name, clientName: client.name,
      collaboratorName: 'Inês Martins', role: 'Emp.Mesa', location: event.location,
      uniform: event.uniform, uniformNotes: event.uniformNotes, startTime: '11:00', endTime: '16:00',
      state: { key: 'qr_generated', label: 'QR Gerado', nextAction: 'check_in' },
    });
    let futureUniform = 'Camisa preta';
    await context.route('**/*', (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === base ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      if (req.method() !== 'GET') {
        writes.push(path);
        if (path === '/services/41' && req.method() === 'PUT') {
          Object.assign(event, req.postDataJSON());
          return route.fulfill({ json: event });
        }
        if (path === '/services/41/workflow/synchronize') return route.fulfill({ json: event });
        return route.fulfill({ status: 405, json: { message: 'Unexpected write' } });
      }
      if (path.startsWith('/qr-check/')) {
        const row = service();
        return route.fulfill({ json: {
          permanent: true, scope: 'collaborator', monthFrom: '2026-11-01', collaboratorName: row.collaboratorName,
          activeDay: row.assignmentDate, appearance: { theme: 'original' }, timeZone: 'Europe/Lisbon',
          active: { collaboratorName: row.collaboratorName, assignmentDate: row.assignmentDate, activeAssignmentId: 1,
            candidateIds: [1], services: [row], total: 1, completedCount: 0, revision: 'uniform' },
          services: [row, { ...row, assignmentId: 2, assignmentDate: '2026-11-19',
            uniform: futureUniform, uniformNotes: '' }],
        } });
      }
      return route.fulfill({ json: {
        '/services': [event], '/services/41': event, '/clients': [client], '/settings': {},
        '/notifications/overview': { notifications: { total: 0, items: [], allItems: [] }, reminders: [] },
      }[path] || [] });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/services?serviceId=41`);
    const dialog = page.getByRole('dialog');
    const notes = dialog.getByLabel('Observações do fardamento (opcional)');
    await notes.fill('Avental fornecido no local.\nLevar gravata preta.');
    assert.equal(await notes.getAttribute('maxlength'), '1000');
    await notes.scrollIntoViewIfNeeded();
    assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/form-${width}.png` });
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(event.uniformNotes, 'Avental fornecido no local.\nLevar gravata preta.');
    assert.equal(event.uniform, 'Camisa Branca');
    await page.goto(`${base}/services?serviceId=41`);
    assert.equal(await notes.inputValue(), event.uniformNotes);
    await page.goto(`${base}/qr/link/fake-uniform-token`);
    const uniform = page.getByRole('region', { name: 'Fardamento' });
    await uniform.getByText('Camisa Branca', { exact: true }).waitFor();
    await uniform.getByText(event.uniformNotes, { exact: true }).waitFor();
    const card = page.locator('.qr-check-card');
    assert.equal(await card.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/link-${width}.png`, fullPage: true });
    await page.locator('.qr-month-day summary').click();
    await uniform.getByText('Camisa preta', { exact: true }).waitFor();
    assert.equal(await uniform.count(), 2);
    assert.equal(await uniform.last().locator('.qr-uniform__note').count(), 0);
    event.uniform = '';
    await page.reload();
    await uniform.getByText(event.uniformNotes, { exact: true }).waitFor();
    assert.equal(await uniform.locator('.qr-uniform__description').count(), 0);
    event.uniformNotes = '';
    futureUniform = '';
    await page.reload();
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).waitFor();
    assert.equal(await uniform.count(), 0);
    assert.equal(writes.filter((path) => path.startsWith('/qr-check/')).length, 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px: event form saves/reopens, current/future services and empty-state hiding verified`);
  }
} finally { await browser.close(); }
