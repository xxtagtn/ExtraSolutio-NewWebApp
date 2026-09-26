// All API requests are intercepted; no application records are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { groupQrRowsByCollaboratorDay } from '../src/utils/communicationQrGroups.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = 'node_modules/.cache/communication-qr-groups';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const row = (assignmentId, collaboratorId, assignmentDate = '2026-09-25') => ({
  assignmentId, collaboratorId, collaboratorName: collaboratorId <= 2 ? 'Ana Cristina Rosa' : `Colaborador ${collaboratorId}`,
  assignmentDate, eventName: 'Restaurante Luz Chakall', role: 'Emp.Mesa',
  startTime: '07:00', endTime: '15:00', checkIn: null, checkOut: null,
  state: { key: 'qr_generated', label: 'QR Gerado' }, qrScope: 'day',
  qrUrl: `https://example.test/qr/day/test-${collaboratorId}-${assignmentDate}`,
});
const rows = [
  row(1, 1), { ...row(2, 1), startTime: '16:00', endTime: '20:00', role: 'Bar' },
  row(3, 2), ...Array.from({ length: 9 }, (_, i) => row(i + 4, i + 3)),
  row(20, 1, '2026-09-26'),
];

try {
  for (const width of [320, 390, 640, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'ui-test', user: { id: 1, role: 'admin' } })));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    let completed = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      assert.equal(request.method(), 'GET', 'The list must not write attendance records');
      const url = new URL(request.url());
      const path = url.pathname.replace('/api', '');
      const send = (json) => route.fulfill({ json });
      if (path === '/notifications/overview') return send({ notifications: { total: 0, items: [], allItems: [] }, reminders: [] });
      if (path === '/notifications/ignored') return send([]);
      if (path === '/communication/tasks') return send({ items: [], events: [], total: 0 });
      if (path === '/qr-codes/events') return send([{ id: '10', name: 'Restaurante Luz Chakall' }]);
      if (path === '/qr-codes/events/10') {
        assert.equal(url.searchParams.get('groupBy'), 'collaboratorDay');
        const groups = groupQrRowsByCollaboratorDay(rows);
        const current = Number(url.searchParams.get('page'));
        const pageSize = Number(url.searchParams.get('pageSize'));
        const selected = groups.slice((current - 1) * pageSize, current * pageSize).flatMap((group) => group.rows);
        return send({
          rows: selected.map((item) => completed && item.assignmentId === 1
            ? { ...item, checkIn: '07:02', checkOut: '15:03', state: { key: 'servico_concluido', label: 'Serviço concluído' } } : item),
          event: { name: 'Restaurante Luz Chakall' }, page: current, pageSize, total: groups.length,
          totalPages: Math.ceil(groups.length / pageSize), summary: { total: rows.length, entries: completed ? 1 : 0, completed: completed ? 1 : 0 },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto(`${baseUrl}/communication`);
    await page.getByRole('button', { name: 'QR Codes / Link', exact: true }).click();
    const table = page.locator('.communication-qr-table');
    const first = table.locator('tbody tr').first();
    await first.getByRole('button', { name: 'Copiar Link de Ana Cristina Rosa' }).waitFor();
    assert.equal(await table.locator('tbody tr').count(), 12);
    assert.equal(await first.locator('.communication-qr-service').count(), 2);
    assert.equal(await first.getByRole('button').count(), 4);
    assert.match(await first.innerText(), /07:00 → 15:00/);
    assert.match(await first.innerText(), /16:00 → 20:00/);
    assert.match(await first.innerText(), /Bar/);
    assert.equal(await table.locator('tbody tr').nth(1).locator('.communication-qr-service').count(), 1, 'Names must not merge distinct collaborators');
    assert.match(await table.locator('tbody tr').last().innerText(), /26\/09\/2026/, 'Days must remain separate');

    await first.getByRole('button', { name: 'Copiar Link de Ana Cristina Rosa' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), rows[0].qrUrl);
    await first.getByRole('button', { name: 'Ver QR Code de Ana Cristina Rosa' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('img').waitFor();
    assert.equal(await dialog.locator('code').innerText(), rows[0].qrUrl);
    const expected = await QRCode.toDataURL(rows[0].qrUrl, { width: 900, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#041012', light: '#ffffff' } });
    const pixels = (url) => PNG.sync.read(Buffer.from(url.split(',')[1], 'base64')).data;
    assert.ok(pixels(await dialog.locator('img').getAttribute('src')).equals(pixels(expected)));
    await dialog.getByRole('button', { name: 'Fechar' }).click();

    completed = true;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await first.getByText('Serviço concluído', { exact: true }).waitFor();
    assert.match(await first.innerText(), /Entrada: 07:02 · Saída: 15:03/);
    assert.equal(await first.getByText('QR Gerado', { exact: true }).count(), 1, 'The second service keeps its own state');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
    const clipped = await table.locator('button, small, .communication-qr-service__schedule, .badge').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent));
    assert.deepEqual(clipped, [], 'No clipped controls or text');
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/grouped-${width}.png` });
    await page.locator('.collab-pagination__size select').selectOption('10');
    await page.waitForFunction(() => document.querySelectorAll('.communication-qr-table tbody tr').length === 10);
    assert.equal(await first.locator('.communication-qr-service').count(), 2);
    await page.getByRole('button', { name: 'Página seguinte' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.communication-qr-table tbody tr').length === 2);
    assert.match(await table.innerText(), /26\/09\/2026/);
    await page.getByRole('button', { name: 'Página anterior' }).click();
    await first.getByRole('button', { name: 'Copiar Link de Ana Cristina Rosa' }).waitFor();
    assert.equal(await first.locator('.communication-qr-service').count(), 2);
    await context.close();
    console.log(`Grouped rows, individual states, pagination, shared link/QR and layout passed at ${width}px`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
