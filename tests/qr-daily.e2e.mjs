// Run against Vite. Browser API requests use the real attendance services with a temporary database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { readDailyQr, registerDailyQr } from '../server/services/qrDailyAttendance.js';
import { readPublicQr, qrCheckoutProtection } from '../server/services/qrAttendance.js';
import { ensureAssignmentQr } from '../server/services/qrCodeGeneration.js';
import { qrCodeStateForAssignment } from '../server/utils/qrCheckins.js';
import { createDailyQrToken } from '../server/utils/qrDailyToken.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'es-daily-browser-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5180';
const output = 'node_modules/.cache/qr-daily';
mkdirSync(output, { recursive: true });
process.env.JWT_SECRET = 'daily-browser-test-signing-key-not-production';
process.env.APP_TIMEZONE = 'Europe/Lisbon';
const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
  env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
});
assert.equal(result.status, 0, result.stderr);
const sqlite = new DatabaseSync(database);
sqlite.exec(result.stdout);
sqlite.close();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
let sequence = 0;

async function setup(width, overlap = false, initialTime = '2026-09-24T08:00:00Z') {
  const collaborator = await db.collaborator.create({ data: { name: 'Colaborador de Teste Nome Comprido', email: `browser-${++sequence}@example.test` } });
  const event = await db.event.create({ data: { name: 'Restaurante de Teste', date: new Date('2026-09-24'), location: 'Lisboa', workLocationsEnabled: true } });
  const workLocation = await db.eventWorkLocation.create({ data: { eventId: event.id, name: 'Sala principal' } });
  const rows = [];
  for (const [plannedCheckIn, plannedCheckOut] of [['09:00', '12:00'], [overlap ? '11:00' : '15:00', '18:00']]) {
    rows.push(await db.eventAssignment.create({ data: {
      eventId: event.id, collaboratorId: collaborator.id, workLocationId: workLocation.id,
      plannedCheckIn, plannedCheckOut, role: 'Emp.Mesa', status: 'confirmed',
    } }));
  }
  const token = createDailyQrToken(collaborator.id, '2026-09-24');
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await context.newPage();
  await page.clock.install();
  page.on('pageerror', (error) => errors.push(error.message));
  let now = new Date(initialTime);
  const posts = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    try {
      if (path.startsWith('/api/qr-check/day/')) {
        let body;
        if (request.method() === 'POST') {
          const data = request.postDataJSON();
          posts.push({ path, data });
          body = await registerDailyQr(db, token, path.endsWith('/check-in') ? 'check_in' : 'check_out', data, { now });
        } else body = await readDailyQr(db, token, { now });
        return route.fulfill({ json: body });
      }
      if (path.startsWith('/api/qr-check/')) {
        const qr = await readPublicQr(db, decodeURIComponent(path.split('/').at(-1)), { now });
        return route.fulfill({ json: {
          ...qr.assignment, collaboratorName: qr.collaborator.name, eventName: qr.event.name,
          assignmentDate: qr.event.date, state: qrCodeStateForAssignment(qr.assignment),
          completed: Boolean(qr.assignment.checkIn && qr.assignment.checkOut), ...qrCheckoutProtection(qr, now),
        } });
      }
      throw new Error(`Unexpected API request ${path}`);
    } catch (error) {
      if (!error.statusCode) errors.push(error.message);
      return route.fulfill({ status: error.statusCode || 500, json: { message: error.message } });
    }
  });
  await page.goto(`${baseUrl}/qr/day/${token}`);
  await page.getByRole('heading', { name: collaborator.name }).waitFor();
  return { page, context, rows, posts, token, setTime: (time, date = '2026-09-24') => { now = new Date(`${date}T${time}+01:00`); } };
}

async function refresh(page) {
  const response = page.waitForResponse((response) => response.url().includes('/api/qr-check/') && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}

async function layout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
  const overflow = await page.locator('.qr-check-card button, .qr-check-card dd, .qr-check-card h1, .qr-check-card h2').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent));
  assert.deepEqual(overflow, [], 'No clipped controls or text');
}

try {
  for (const width of [320, 390, 1440]) {
    const f = await setup(width, false, '2026-09-23T08:00:00Z');
    const entry = f.page.getByRole('button', { name: 'Dar Entrada' });
    assert.equal(await entry.isDisabled(), true);
    assert.equal(await f.page.locator('.qr-day-summary li').count(), 2);
    await f.page.getByText('Picagens disponíveis em 24/09/2026, a partir das 00:00.').waitFor();
    await entry.evaluate((button) => button.click());
    assert.equal(f.posts.length, 0);
    await layout(f.page);
    await f.page.screenshot({ path: `${output}/preview-${width}.png`, fullPage: true });
    f.setTime('23:59:59', '2026-09-23');
    await f.page.reload();
    await f.page.getByText('Picagens disponíveis em 24/09/2026, a partir das 00:00.').waitFor();
    assert.equal(await entry.isDisabled(), true);
    f.setTime('00:00:00');
    await f.page.clock.runFor(1100);
    await f.page.waitForFunction(() => !document.querySelector('.qr-check-command')?.disabled);
    assert.equal(f.posts.length, 0, 'Opening the day must not automatically punch');
    assert.equal((await db.eventAssignment.findUnique({ where: { id: f.rows[0].id } })).checkIn, null);
    await entry.click();
    await f.page.getByRole('button', { name: 'Dar Saída' }).waitFor();
    assert.equal(f.posts.length, 1);
    await f.context.close();
    console.log(`24h preview and automatic midnight unlock passed at ${width}px`);
  }
  for (const width of [320, 390, 768, 1440]) {
    const f = await setup(width);
    const { page } = f;
    const entry = page.getByRole('button', { name: 'Dar Entrada' });
    await layout(page);
    await page.screenshot({ path: `${output}/daily-${width}.png`, fullPage: true });
    await entry.evaluate((button) => { button.click(); button.click(); });
    const exit = page.getByRole('button', { name: 'Dar Saída' });
    await exit.waitFor();
    assert.equal(await exit.isDisabled(), true);
    assert.equal(f.posts.length, 1);
    f.setTime('09:29:59');
    await refresh(page);
    assert.equal(await exit.isDisabled(), true);
    f.setTime('09:30:00');
    await refresh(page);
    await page.waitForFunction(() => !document.querySelector('.qr-check-command')?.disabled);
    f.setTime('12:00:00');
    await exit.evaluate((button) => { button.click(); button.click(); });
    await entry.waitFor();
    assert.equal(await entry.isDisabled(), true);
    assert.equal(f.posts.length, 2);
    assert.match(await page.locator('.qr-day-current').innerText(), /15:00 → 18:00/);
    assert.equal((await db.eventAssignment.findUnique({ where: { id: f.rows[1].id } })).checkIn, null);
    f.setTime('12:00:02');
    await page.clock.runFor(2100);
    await page.waitForFunction(() => !document.querySelector('.qr-check-command')?.disabled);
    f.setTime('15:00:00');
    await entry.click();
    await exit.waitFor();
    f.setTime('18:00:00');
    await refresh(page);
    await page.waitForFunction(() => !document.querySelector('.qr-check-command')?.disabled);
    await exit.click();
    await page.getByText('Todos os serviços deste dia estão concluídos.').waitFor();
    assert.equal(f.posts.length, 4);
    assert.deepEqual(f.posts.map((request) => request.data.assignmentId), [f.rows[0].id, f.rows[0].id, f.rows[1].id, f.rows[1].id]);
    assert.ok(f.posts.every((request) => /^[a-f0-9]{64}$/.test(request.data.revision)));
    await layout(page);
    await page.screenshot({ path: `${output}/completed-${width}.png`, fullPage: true });
    // Administrative corrections reopen the corresponding action on this same link.
    await db.eventAssignment.update({ where: { id: f.rows[1].id }, data: { checkOut: null } });
    f.setTime('18:05:00');
    await refresh(page);
    await exit.waitFor();
    await exit.click();
    await page.getByText('Todos os serviços deste dia estão concluídos.').waitFor();
    // Existing individual URLs still render the legacy screen, not another daily group.
    const qr = await ensureAssignmentQr(db, f.rows[0].id);
    await page.goto(`${baseUrl}/qr/${qr.token}`);
    await page.getByText('Entrada e saída já registadas.').waitFor();
    assert.equal(await page.locator('.qr-day-summary').count(), 0);
    await f.context.close();
    console.log(`Daily workflow, double-tap, cooldown, corrections, legacy link and layout passed at ${width}px`);
  }
  const f = await setup(390, true);
  assert.equal(await f.page.locator('.qr-check-command').count(), 0);
  await f.page.getByRole('radio').nth(1).check();
  await f.page.getByRole('button', { name: 'Dar Entrada' }).waitFor();
  await layout(f.page);
  await f.page.screenshot({ path: `${output}/overlap-390.png`, fullPage: true });
  await f.page.getByRole('button', { name: 'Dar Entrada' }).click();
  await f.page.getByRole('button', { name: 'Dar Saída' }).waitFor();
  assert.equal(f.posts[0].data.assignmentId, f.rows[1].id);
  assert.equal(await f.page.getByRole('radio').count(), 0);
  await f.context.close();
  assert.deepEqual(errors, []);
  console.log('Overlap selection passed; no browser errors or real application data touched.');
} finally {
  await browser.close();
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
}
