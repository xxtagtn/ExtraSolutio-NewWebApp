// Run against Vite with Playwright installed, or set PLAYWRIGHT_MODULE to its absolute path.
// All API requests are intercepted; no real records or messages are changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { communicationSummary } from '../src/utils/communicationCenter.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5177';
const output = 'node_modules/.cache/communication-mobile';
await mkdir(output, { recursive: true });
const errors = [];
const tasks = Array.from({ length: 32 }, (_, index) => ({
  id: `reminder_24h:${index + 1}`, assignmentId: index + 1, collaboratorId: index + 1,
  collaboratorName: index === 1 ? 'Ana Isabel Domingues Nome Comprido' : `Colaborador ${String(index + 1).padStart(2, '0')}`,
  serviceId: 10, eventName: 'Restaurante Luz Chakall', clientName: 'Cliente de teste',
  date: '2026-09-24', startTime: '11:00', endTime: '15:00', role: 'Emp.Mesa',
  rawPhone: `900000${String(index + 1).padStart(3, '0')}`, kind: index === 2 ? 'confirmation' : 'reminder_24h',
  message: `Mensagem original ${index + 1}`, state: 'ready', whatsappEnabled: true,
}));
const rowFor = (task) => ({
  assignmentId: task.assignmentId, collaboratorName: task.collaboratorName,
  eventName: task.eventName, assignmentDate: task.date,
  startTime: task.startTime, endTime: task.endTime,
  qrUrl: `https://example.test/qr/individual-${task.assignmentId}`,
  state: { key: 'qr_generated', label: 'QR Gerado' },
});

async function setup(width, restricted = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript((restricted) => {
    localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'ui-test', user: {
      id: 1, role: restricted ? 'operations' : 'admin', ...(restricted ? { permissions: ['communication.view'] } : {}),
    } }));
  }, restricted);
  const page = await context.newPage();
  await page.clock.install();
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  const writes = [];
  let removedId = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    requests.push(path);
    const send = (json) => route.fulfill({ json });
    if (request.method() !== 'GET') {
      writes.push({ path, body: request.postDataJSON() });
      return send({});
    }
    if (path === '/notifications/overview') return send({ notifications: { total: 0, items: [], allItems: [] }, reminders: [] });
    if (path === '/notifications/ignored') return send([]);
    if (path === '/communication/tasks') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const kind = url.searchParams.get('kind');
      const filtered = tasks.filter((task) => task.id !== removedId && task.collaboratorName.toLowerCase().includes(search) && (kind === 'all' || kind === task.kind));
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      return send({ items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize), summary: communicationSummary(filtered), events: [{ id: 10, name: 'Restaurante Luz Chakall' }] });
    }
    if (path.startsWith('/qr-codes/assignments/')) return send(rowFor(tasks.find((task) => task.assignmentId === Number(path.split('/').at(-1)))));
    if (path === '/qr-codes/events') return send([{ id: '10', name: 'Restaurante Luz Chakall' }]);
    if (path.startsWith('/qr-codes/events/')) return send({ rows: tasks.map(rowFor), event: { name: 'Restaurante Luz Chakall' }, total: 32, totalPages: 1 });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto(`${baseUrl}/communication`);
  await page.locator('.communication-task').first().waitFor();
  return { context, page, requests, writes, remove: (id) => { removedId = id; } };
}

async function assertLayout(page) {
  const problems = await page.locator('.communication-list').evaluate((list) => {
    const viewport = window.innerWidth;
    return [...list.querySelectorAll('button, textarea, input')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height && (rect.left < -1 || rect.right > viewport + 1 || element.scrollWidth > element.clientWidth + 1);
    }).map((element) => element.outerHTML.slice(0, 180));
  });
  assert.deepEqual(problems, [], 'Controls must not overflow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}

try {
  for (const width of [320, 390, 768, 900]) {
    const { context, page, requests, writes } = await setup(width);
    const rows = page.locator('.communication-task-row');
    const first = rows.nth(0);
    const second = rows.nth(1);
    const preview = page.locator('.communication-preview--inline');
    assert.equal(await page.locator('.communication-preview').count(), 0);
    assert.equal(requests.some((path) => path.startsWith('/qr-codes/')), false, 'No hidden QR requests');
    await first.locator('.communication-task').click();
    await first.getByRole('button', { name: 'Copiar Link de Colaborador 01' }).waitFor();
    assert.equal(await preview.count(), 1);
    assert.equal(await page.locator('aside.communication-preview').count(), 0);
    assert.equal(await first.locator('.communication-task').getAttribute('aria-expanded'), 'true');
    const tools = first.locator('.communication-inline-tools');
    assert.equal(await tools.getByRole('button').count(), 3);
    for (const button of await tools.getByRole('button').all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.width >= 44);
    }
    await assertLayout(page);
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/expanded-${width}.png` });
    await first.getByRole('button', { name: 'Copiar Link de Colaborador 01' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-1');
    await first.getByRole('button', { name: 'Ver QR Code de Colaborador 01' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('img').waitFor();
    assert.equal(await dialog.locator('code').innerText(), 'https://example.test/qr/individual-1');
    const expectedImage = await QRCode.toDataURL('https://example.test/qr/individual-1', { width: 900, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#041012', light: '#ffffff' } });
    const actualPixels = PNG.sync.read(Buffer.from((await dialog.locator('img').getAttribute('src')).split(',')[1], 'base64')).data;
    const expectedPixels = PNG.sync.read(Buffer.from(expectedImage.split(',')[1], 'base64')).data;
    assert.ok(actualPixels.equals(expectedPixels), 'QR pixels must match the individual link');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await first.getByRole('button', { name: 'Mensagem', exact: true }).click();
    await first.locator('textarea').fill('Mensagem editada para o primeiro colaborador');
    await first.getByRole('button', { name: 'Copiar', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Mensagem editada para o primeiro colaborador');
    // Polling must neither replace the editor nor steal focus.
    await first.locator('textarea').focus();
    const refreshed = page.waitForResponse((response) => response.url().includes('/communication/tasks'));
    await page.clock.fastForward(15000);
    await refreshed;
    assert.equal(await first.locator('textarea').evaluate((el) => el === document.activeElement), true);
    assert.equal(await first.locator('textarea').inputValue(), 'Mensagem editada para o primeiro colaborador');
    await assertLayout(page);

    // Switch while a taller panel above is open. Keep the tapped row in view.
    await second.locator('.communication-task').scrollIntoViewIfNeeded();
    await second.locator('.communication-task').click();
    await second.getByRole('button', { name: /Copiar Link de Ana/ }).waitFor();
    assert.equal(await preview.count(), 1);
    assert.equal(await first.locator('.communication-preview').count(), 0);
    const rowBounds = await second.locator('.communication-task').boundingBox();
    assert.ok(rowBounds.y >= 0 && rowBounds.y < 900, `Tapped row is lost after switching: ${rowBounds.y}`);
    await second.getByRole('button', { name: /Copiar Link de Ana/ }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-2');
    await second.locator('.communication-task').click();
    assert.equal(await preview.count(), 0);
    const qrReads = requests.filter((path) => path.startsWith('/qr-codes/')).length;
    await page.clock.fastForward(15000);
    assert.equal(await preview.count(), 0, 'Refresh cannot reopen a collapsed row');
    assert.equal(requests.filter((path) => path.startsWith('/qr-codes/')).length, qrReads, 'Collapsed rows cannot keep polling QR data');
    await first.locator('.communication-task').click();
    await first.getByRole('button', { name: 'Mensagem', exact: true }).click();
    assert.equal(await first.locator('textarea').inputValue(), 'Mensagem editada para o primeiro colaborador');
    await first.getByRole('button', { name: 'Respondeu', exact: true }).click();
    assert.equal(writes.at(-1).path, '/communication-logs');
    assert.equal(writes.at(-1).body.assignmentId, 1);
    assert.equal(writes.at(-1).body.message, 'Mensagem editada para o primeiro colaborador');
    await first.locator('.communication-task').click();
    await second.getByRole('checkbox').uncheck();
    assert.equal(await preview.count(), 0, 'Checkbox cannot toggle the accordion');
    assert.deepEqual(writes.at(-1), { path: '/assignments/2', body: { whatsappEnabled: false } });
    await second.locator('.communication-task').click();
    await second.getByRole('button', { name: 'Mensagem', exact: true }).click();
    assert.equal(await second.getByRole('button', { name: 'Abrir WhatsApp' }).isDisabled(), true);
    await page.getByRole('combobox', { name: 'Tipo de mensagem' }).selectOption('confirmation');
    await rows.first().getByText('Colaborador 03', { exact: true }).waitFor();
    assert.equal(await preview.count(), 0);
    await rows.first().locator('.communication-task').click();
    assert.equal(await preview.locator('.communication-reminder-qr').count(), 0, 'Preserve reminder-only QR availability');
    await page.getByRole('combobox', { name: 'Tipo de mensagem' }).selectOption('all');
    await first.getByText('Colaborador 01', { exact: true }).waitFor();
    assert.equal(await preview.count(), 0);
    await first.locator('.communication-task').click();
    await page.getByRole('button', { name: 'Página seguinte' }).click();
    await first.getByText('Colaborador 26', { exact: true }).waitFor();
    assert.equal(await preview.count(), 0, 'Pagination resets the open row');
    await first.locator('.communication-task').click();
    await first.getByRole('button', { name: 'Copiar Link de Colaborador 26' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-26');
    await assertLayout(page);
    await context.close();
    console.log(`PASS mobile ${width}px: accordion, actions, QR identity, drafts, polling, checkbox, filters, paging, layout`);
  }

  for (const width of [901, 1280, 1440]) {
    const { context, page } = await setup(width);
    const preview = page.locator('aside.communication-preview');
    await preview.locator('textarea').waitFor();
    assert.equal(await page.locator('.communication-preview--inline').count(), 0);
    assert.equal(await page.locator('.communication-task[aria-expanded]').count(), 0);
    await preview.locator('textarea').fill('Desktop draft');
    await page.locator('.communication-task').nth(1).click();
    await preview.getByRole('button', { name: /Copiar Link de Ana/ }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-2');
    await page.locator('.communication-task').first().click();
    assert.equal(await preview.locator('textarea').inputValue(), 'Desktop draft');
    await page.screenshot({ path: `${output}/desktop-${width}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await preview.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.communication-preview').count(), 0);
    await page.locator('.communication-task').first().click();
    await page.getByRole('button', { name: 'Mensagem', exact: true }).click();
    assert.equal(await page.locator('.communication-preview textarea').inputValue(), 'Desktop draft');
    await page.setViewportSize({ width, height: 900 });
    await preview.locator('textarea').waitFor();
    assert.equal(await preview.locator('textarea').inputValue(), 'Desktop draft');
    await context.close();
    console.log(`PASS desktop ${width}px: selection, existing panel, drafts and responsive transitions`);
  }

  const dynamic = await setup(390);
  await dynamic.page.locator('.communication-task').first().click();
  await dynamic.page.getByRole('button', { name: 'QR Codes / Link', exact: true }).click();
  await dynamic.page.locator('.communication-qr-table').getByRole('button', { name: 'Copiar Link de Colaborador 01' }).click();
  assert.equal(await dynamic.page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-1');
  await dynamic.page.getByRole('button', { name: 'Mensagens', exact: true }).click();
  await dynamic.page.locator('.communication-task').first().waitFor();
  assert.equal(await dynamic.page.locator('.communication-preview').count(), 0);
  await dynamic.page.locator('.communication-task').first().focus();
  await dynamic.page.keyboard.press('Enter');
  await dynamic.page.getByRole('button', { name: 'Mensagem', exact: true }).waitFor();
  dynamic.remove(tasks[0].id);
  const removed = dynamic.page.waitForResponse((response) => response.url().includes('/communication/tasks'));
  await dynamic.page.clock.fastForward(15000);
  await removed;
  await dynamic.page.locator('.communication-preview').waitFor({ state: 'detached' });
  assert.equal(await dynamic.page.locator('.communication-task[aria-expanded="true"]').count(), 0);
  const search = dynamic.page.getByPlaceholder('Pesquisar colaborador, evento, fun\u00e7\u00e3o ou telefone');
  await search.fill('Ana Isabel');
  const filtered = dynamic.page.waitForResponse((response) => response.url().includes('search=Ana'));
  await dynamic.page.clock.fastForward(300);
  await filtered;
  await dynamic.page.locator('.communication-task').first().click();
  await dynamic.page.getByRole('button', { name: /Copiar Link de Ana/ }).click();
  assert.equal(await dynamic.page.evaluate(() => navigator.clipboard.readText()), 'https://example.test/qr/individual-2');
  await dynamic.context.close();
  console.log('PASS QR tab, keyboard, dynamic removal and search');

  const { context, page, requests } = await setup(390, true);
  await page.locator('.communication-task').first().click();
  await page.getByRole('button', { name: 'Mensagem', exact: true }).click();
  assert.equal(await page.locator('.communication-reminder-qr').count(), 0);
  assert.equal(requests.some((path) => path.startsWith('/qr-codes/')), false);
  await context.close();
  assert.deepEqual(errors, []);
  console.log('PASS permissions and no browser errors');
} finally {
  await browser.close();
}
