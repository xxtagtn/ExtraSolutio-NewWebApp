// Browser APIs are simulated. No real collaborator or attendance data is changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5193';
const output = 'node_modules/.cache/collaborator-attendance-link';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'fixed-link-test', user: { id: 1, name: 'QA', role: 'admin' } }));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => { window.copiedLink = value; } } });
    });
    let active = true, token = 'a'.repeat(43), entered = false, completed = false, empty = false, confirmedServices = 8, listEmpty = false;
    let searches = [], writes = [], legacyRequests = [];
    const name = 'Ana Carolina Rodrigues';
    const service = () => ({ assignmentId: 1, assignmentDate: '2026-11-01', eventName: 'Restaurante Luz Chakall',
      collaboratorName: name, clientName: 'SUPREME', role: 'Emp.Mesa', location: 'Estádio da Luz',
      startTime: '09:00', endTime: '12:00', checkIn: entered ? '09:00' : null, checkOut: completed ? '12:00' : null,
      state: { key: entered ? 'checked_in' : 'qr_generated', label: entered ? 'Entrada registada' : 'QR Gerado',
        nextAction: entered ? 'check_out' : 'check_in' } });
    const futureServices = () => ['2026-12-05', '2026-12-31', '2027-01-03', '2027-03-10', '2027-06-20', '2028-01-08']
      .map((day, index) => ({ ...service(), assignmentId: index + 2, assignmentDate: day,
        eventName: `Evento futuro ${day}`, checkIn: null, checkOut: null }));
    const payload = () => ({ scope: 'collaborator', permanent: true, monthFrom: '2026-11-01',
      collaboratorName: name, timeZone: 'Europe/Lisbon', appearance: { theme: 'original' },
      activeDay: empty || completed ? null : '2026-11-01',
      active: empty || completed ? null : { collaboratorName: name, assignmentDate: '2026-11-01',
        activeAssignmentId: 1, candidateIds: [1], services: [service()], revision: entered ? 'entered' : 'initial' },
      services: empty ? [] : [...(completed ? [] : [service()]), ...futureServices()],
      ...(completed ? { checkoutReceipt: { ...service(), plannedCheckIn: '09:00', plannedCheckOut: '12:00' } } : {}) });
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      if (url.pathname.startsWith('/api/qr-codes/events')) legacyRequests.push(url.pathname);
      if (url.pathname.startsWith('/api/qr-check/link/')) {
        if (!active || !url.pathname.includes(token)) return route.fulfill({ status: 404, json: { message: 'Este endereço não está disponível.' } });
        if (req.method() === 'POST') {
          writes.push(url.pathname);
          assert.equal(req.postDataJSON().assignmentId, 1);
          if (url.pathname.endsWith('/check-in')) entered = true;
          if (url.pathname.endsWith('/check-out')) completed = true;
        }
        return route.fulfill({ json: payload() });
      }
      if (url.pathname === '/api/qr-codes/links') {
        searches.push(url.searchParams.get('search'));
        return route.fulfill({ json: { items: listEmpty ? [] : [{ id: 1, name, shortName: null, confirmedServices }], monthFrom: '2026-11-01', includesFutureMonths: true, total: listEmpty ? 0 : 1, page: 1, pageSize: 25, totalPages: 1 } });
      }
      if (url.pathname === '/api/qr-codes/links/1') {
        writes.push(url.pathname);
        if (req.postDataJSON()?.replace) token = 'b'.repeat(43);
        return route.fulfill({ json: { attendanceQrUrl: `${base}/qr/link/${token}` } });
      }
      return route.fulfill({ json: url.pathname === '/api/communication/tasks' ? { items: [], summary: {} } : [] });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/communication`);
    await page.getByRole('button', { name: 'Links de picagem', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'QR Codes / Link', exact: true }).count(), 0);
    assert.equal(await page.getByRole('navigation', { name: 'Áreas de comunicação' }).getByRole('button').count(), 2);
    await page.getByRole('button', { name: 'Links de picagem', exact: true }).click();
    const table = page.locator('.attendance-links-table');
    await table.getByRole('columnheader', { name: 'Serviços confirmados', exact: true }).waitFor();
    assert.deepEqual(await table.getByRole('columnheader').allTextContents(), ['Nome', 'Serviços confirmados', 'Ação']);
    assert.equal(await page.locator('.attendance-links-heading > span').count(), 0, 'Confirmed counts are not restricted to one month');
    assert.equal(await table.locator('thead').evaluate((el) => getComputedStyle(el).display), 'table-header-group', 'Mobile remains a table, not separate cards');
    await table.locator('.attendance-links-count strong').getByText('8', { exact: true }).waitFor();
    const aligned = await table.evaluate((el) => [...el.querySelectorAll('thead th')].every((th, index) => {
      const td = el.querySelector('tbody tr').children[index];
      return Math.abs(th.getBoundingClientRect().x - td.getBoundingClientRect().x) < 1
        && Math.abs(th.getBoundingClientRect().width - td.getBoundingClientRect().width) < 1;
    }));
    assert.equal(aligned, true, 'Headers and cells stay aligned in all three columns');
    confirmedServices = 9;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await table.locator('.attendance-links-count strong').getByText('9', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Ver QR|Imprimir|Download|Descarregar/ }).count(), 0);
    await page.getByRole('button', { name: 'Copiar link de picagem', exact: true }).click();
    await page.getByText('Link copiado', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.copiedLink), `${base}/qr/link/${token}`);
    await page.getByRole('searchbox', { name: 'Pesquisar colaborador nos links de picagem' }).fill('Carolina');
    await page.waitForTimeout(350); assert.ok(searches.includes('Carolina'));
    await page.getByRole('button', { name: `Gerar novo link de ${name}`, exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(token, 'a'.repeat(43));
    await page.getByRole('button', { name: `Gerar novo link de ${name}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Gerar novo link', exact: true }).click();
    await page.getByText('Novo link criado. O anterior deixou de funcionar.', { exact: true }).waitFor();
    assert.equal(token, 'b'.repeat(43));
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Copiar link de picagem', exact: true }).click();
    await page.waitForFunction((expected) => window.copiedLink === expected, `${base}/qr/link/${token}`);
    assert.equal(await page.evaluate(() => window.copiedLink), `${base}/qr/link/${token}`);
    assert.deepEqual(legacyRequests, [], 'The removed tab cannot keep loading/polling service QR lists');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/management-${width}.png`, fullPage: true });
    listEmpty = true;
    await page.getByRole('searchbox', { name: 'Pesquisar colaborador nos links de picagem' }).fill('');
    await page.getByText('Sem colaboradores com serviços confirmados.', { exact: true }).waitFor();
    assert.equal(await table.getByRole('button').count(), 0);
    assert.match(await page.locator('.attendance-links .collab-pagination__summary').innerText(), /0-0 de 0/);
    listEmpty = false;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await table.getByText(name, { exact: true }).waitFor();
    const publicUrl = `${base}/qr/link/${token}`;
    await page.goto(publicUrl);
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).waitFor();
    assert.equal(await page.getByText(/Válido até/).count(), 0);
    assert.equal(await page.locator('.qr-month-label').count(), 0, 'A permanent multi-month link must not imply a monthly limit');
    await page.getByText('05/12/2026', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Página seguinte', exact: true }).click();
    await page.getByText('08/01/2028', { exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Pesquisar evento ou dia', exact: true }).fill('2027');
    await page.getByText('03/01/2027', { exact: true }).waitFor();
    assert.equal(await page.locator('.qr-month-day').count(), 3);
    await page.getByRole('searchbox', { name: 'Pesquisar evento ou dia', exact: true }).fill('');
    await page.locator('.qr-month-day summary').filter({ hasText: '05/12/2026' }).click();
    await page.getByRole('heading', { name: 'Evento futuro 2026-12-05', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Dar Entrada', exact: true }).count(), 1, 'Only the active service has a punch control');
    assert.equal(writes.filter((path) => path.startsWith('/api/qr-check/')).length, 0, 'Previewing/searching future months never punches');
    await page.screenshot({ path: `${output}/future-months-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).click();
    await page.getByRole('button', { name: 'Dar Saída', exact: true }).click();
    await page.getByRole('region', { name: 'Serviço acabado de concluir' }).count();
    await page.getByRole('region', { name: 'Próximos Serviços', exact: true }).waitFor();
    await page.getByText('05/12/2026', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Dar Entrada|Dar Saída/ }).count(), 0);
    assert.equal(await page.getByText('Restaurante Luz Chakall', { exact: true }).count(), 1, 'Only the temporary checkout receipt remains');
    active = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'Página não encontrada', exact: true }).waitFor();
    assert.equal(await page.getByText(name, { exact: true }).count(), 0);
    assert.equal(await page.getByText('Restaurante Luz Chakall', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Evento futuro 2026-12-05', { exact: true }).count(), 0);
    assert.equal(await page.locator('.qr-check-checkout-reminder').count(), 0);
    await page.screenshot({ path: `${output}/not-found-${width}.png` });
    active = true; empty = true; completed = false;
    await page.goto(publicUrl);
    await page.getByText('Não tens serviços disponíveis para picar neste momento.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Dar Entrada|Dar Saída/ }).count(), 0);
    await page.screenshot({ path: `${output}/empty-${width}.png` });
    empty = false; entered = false;
    await page.goto(publicUrl);
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).waitFor();
    active = false; const before = writes.length;
    await page.getByRole('button', { name: 'Dar Entrada', exact: true }).click();
    await page.getByRole('heading', { name: 'Página não encontrada', exact: true }).waitFor();
    assert.equal(writes.length, before, 'A stale page never records an inactive collaborator punch');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Fixed links: future months/years, search/pagination, management, replacement, public punches, empty/inactive privacy at ${width}px`);
  }
} finally { await browser.close(); }
