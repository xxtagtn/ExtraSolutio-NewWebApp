// Read-only fixtures. Every API request is intercepted; no real records are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { filterCollaborators } from '../src/utils/collaboratorFilters.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5176';
const output = 'node_modules/.cache/collaborator-search';
await mkdir(output, { recursive: true });
const people = [
  { id: 1, name: 'Rita da Silva', shortName: 'Rita Silva', roles: ['Barman','Copa Fina'], hasOwnCar: true, residenceArea: 'Sintra', notes: 'Boa experiência em casamentos. Confidencial da ficha.', availability: 'Fins de semana' },
  { id: 2, name: 'Rita Mendes', roles: ['Emp.Mesa'], residenceArea: 'Lisboa', notes: 'Não pode trabalhar à noite', status: 'inactive' },
  { id: 3, name: 'João da Costa', roles: ['Ajd.Cozinha','Copa Fina'], hasOwnCar: true, residenceArea: 'Sintra', notes: 'Experiência em casamentos', availability: 'Sábados à noite' },
  { id: 4, name: 'Joao Santos', roles: ['Barman'], residenceArea: 'Cascais', notes: 'Tem carro emprestado', status: 'paused' },
  ...Array.from({ length: 24 }, (_,i) => ({ id: i + 5, name: `Pessoa ${String(i).padStart(2,'0')}`, roles: ['Emp.Mesa','Copa Fina'],
    hasOwnCar: i % 2 === 0, residenceArea: 'Oeiras', notes: i === 23 ? 'Agendamento especial' : 'Equipa de apoio', isPreferred: i === 12 })),
].map(row => ({ status: 'active', hasOwnCar: false, photo: null, photoThumb: null, email: `person-${row.id}@example.invalid`, ...row }));
const errors = [], writes = [];
let lastPage;
async function setup(width, sensitive = true) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript((sensitive) => localStorage.setItem('extrasolutio.auth', JSON.stringify({ token: 'qa', sessionId: 'search-qa',
    lastActivityAt: Date.now(), user: { id: 1, name: 'Search QA', role: sensitive ? 'admin' : 'operations',
      ...(sensitive ? {} : { permissions: ['collaborators.view'] }) } })), sensitive);
  const page = await context.newPage(); lastPage = page;
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let slowRita = false;
  const visible = row => sensitive ? row : { ...row, notes: null, residenceArea: null, nif: null };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    if (request.method() !== 'GET') { writes.push({ path, method: request.method() }); return route.fulfill({ json: {} }); }
    if (path === '/api/collaborators' && url.searchParams.has('page')) {
      const p = url.searchParams;
      const params = Object.fromEntries(p); requests.push(params);
      const rows = filterCollaborators(people, { search: p.get('search') || '', roleFilter: p.get('role') || '',
        statusFilter: p.get('status') || '', zoneFilter: p.get('zone') || '', ownCarFilter: p.get('ownCar') || '' }, { includeSensitive: sensitive })
        .sort((a,b) => Number(Boolean(b.isPreferred)) - Number(Boolean(a.isPreferred)) || a.name.localeCompare(b.name,'pt'));
      const pageNumber = Number(p.get('page')), pageSize = Number(p.get('pageSize'));
      if (slowRita && p.get('search') === 'Rita') await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ json: { items: rows.slice((pageNumber-1)*pageSize, pageNumber*pageSize).map(visible),
        total: rows.length, page: pageNumber, pageSize, totalPages: Math.max(1,Math.ceil(rows.length/pageSize)) } }).catch(()=>{});
    }
    return route.fulfill({ json: path === '/api/collaborators' ? people.map(visible)
      : path === '/api/collaborators/roles' ? ['Barman','Copa Fina','Emp.Mesa','Ajd.Cozinha']
        : path === '/api/notifications/overview' ? { notifications: { total: 0, items: [], allItems: [] }, reminders: [] }
          : path === '/api/collaborators/gender-summary' ? { total: 0 }
            : /^\/api\/collaborators\/\d+$/.test(path) ? visible(people.find(row => row.id === Number(path.split('/').at(-1)))) : [] });
  });
  await page.goto(`${base}/collaborators`);
  await idle(page);
  return { page, context, requests, slow: value => { slowRita = value; } };
}
async function idle(page) {
  await page.locator('.collab-details-list').waitFor();
  await page.waitForFunction(() => document.querySelector('.collab-details-list')?.getAttribute('aria-busy') === 'false');
}
const listResponse = (page, predicate) => page.waitForResponse(response => {
  const url = new URL(response.url());
  return url.pathname === '/api/collaborators' && url.searchParams.has('page') && predicate(url.searchParams);
});
async function search(page, text) {
  const response = listResponse(page, p => (p.get('search') || '') === text.trim() && p.get('page') === '1');
  await page.getByRole('searchbox', { name: 'Pesquisar colaboradores' }).fill(text);
  await response; await idle(page);
}
async function names(page) {
  return page.locator('.collab-detail-card .collab-top-grid > .collab-col:first-child > strong').allTextContents();
}
async function assertNames(page, expected) {
  assert.deepEqual((await names(page)).map(name => name.trim()).sort(), expected.sort());
}
async function reset(page) {
  const response = listResponse(page, p => !p.has('search') && !p.has('role') && !p.has('zone') && !p.has('status') && !p.has('ownCar'));
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click(); await response; await idle(page);
}
try {
  for (const width of [320,390,768,1440]) {
    const { page, context, requests, slow } = await setup(width);
    await search(page, 'RÍTA da SILVA'); await assertNames(page, ['Rita Silva']);
    await search(page, 'Silv'); await assertNames(page, ['Rita Silva']);
    await search(page, 'Ajudante de cozinha'); await assertNames(page, ['João da Costa']);
    await search(page, 'experiencia casamentos'); await assertNames(page, ['Rita Silva','João da Costa']);
    await search(page, 'SINTRA'); await assertNames(page, ['Rita Silva','João da Costa']);
    await search(page, 'Rita Bar'); await assertNames(page, ['Rita Silva']);
    await search(page, 'Copa Sintra'); await assertNames(page, ['Rita Silva','João da Costa']);
    await search(page, 'Rita Bar casamentos Sintra'); await assertNames(page, ['Rita Silva']);
    await page.getByLabel('Função', { exact: true }).selectOption('Copa Fina'); await idle(page);
    await page.getByLabel('Estado do colaborador', { exact: true }).selectOption('active'); await idle(page);
    await page.getByLabel('Viatura própria', { exact: true }).selectOption('true'); await idle(page);
    const zoneResponse = listResponse(page, p => p.get('zone') === 'Sintra');
    await page.getByLabel('Zona de residência', { exact: true }).fill('Sintra'); await zoneResponse; await idle(page);
    await assertNames(page, ['Rita Silva']);
    const cleared = listResponse(page, p => !p.has('search') && p.get('zone') === 'Sintra' && p.get('ownCar') === 'true');
    await page.getByRole('button', { name: 'Limpar pesquisa', exact: true }).click(); await cleared; await idle(page);
    await assertNames(page, ['Rita Silva','João da Costa']);
    assert.equal(await page.getByLabel('Função', { exact: true }).inputValue(), 'Copa Fina');
    assert.equal(await page.getByLabel('Zona de residência', { exact: true }).inputValue(), 'Sintra');
    assert.ok(await page.getByRole('searchbox').evaluate(input => {
      const style = getComputedStyle(input), canvas = document.createElement('canvas');
      const context = canvas.getContext('2d'); context.font = style.font;
      return context.measureText(input.placeholder).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }), `Placeholder clipped at ${width}`);
    await page.screenshot({ path: `${output}/filters-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`);
    await search(page, 'naoexiste'); await page.getByText('Nenhum colaborador encontrado.', { exact: true }).waitFor();
    await page.getByRole('status').getByText('0 colaboradores', { exact: true }).waitFor();
    await reset(page);
    await search(page, 'Pessoa Copa');
    assert.equal((await names(page)).length, 10);
    const next = listResponse(page, p => p.get('page') === '2');
    await page.getByRole('button', { name: 'Página seguinte', exact: true }).click(); await next; await idle(page);
    assert.equal(new Set(await names(page)).size, 10);
    await search(page, 'agendamento especial'); await assertNames(page, ['Pessoa 23']);
    assert.equal(requests.at(-1).page, '1');
    await reset(page);
    const before = requests.length;
    const debounced = listResponse(page, p => p.get('search') === 'Rita Bar');
    await page.getByRole('searchbox').pressSequentially('Rita Bar', { delay: 12 });
    await debounced; await idle(page);
    assert.equal(requests.length - before, 1, 'No server request for every keystroke');

    slow(true);
    const oldRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get('search') === 'Rita');
    await page.getByRole('searchbox').fill('Rita');
    assert.equal((await names(page)).length, 1, 'Previous card is not blanked during debounce');
    await oldRequest;
    await search(page, 'Joao'); await assertNames(page, ['João da Costa','Joao Santos']);
    await page.waitForTimeout(1000);
    await assertNames(page, ['João da Costa','Joao Santos']);
    await context.close();
    console.log(`PASS ${width}px: combined search, filters, clears, no results, pagination, debounce, stale responses and no overflow`);
  }
  const { page, context } = await setup(390, false);
  assert.equal(await page.getByLabel('Zona de residência', { exact: true }).count(), 0);
  assert.ok(!(await page.getByRole('searchbox').getAttribute('placeholder')).includes('notas'));
  await search(page, 'Confidencial'); await assertNames(page, []);
  await search(page, 'Rita Bar'); await assertNames(page, ['Rita Silva']);
  await context.close();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log('PASS restricted permissions, zero writes and no browser errors');
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    console.error(lastPage.url(), (await lastPage.locator('body').innerText()).slice(0,2500), errors);
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
