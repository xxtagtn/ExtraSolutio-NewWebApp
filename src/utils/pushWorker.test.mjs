import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/service-worker.js', 'utf8');
const origin = 'https://example.test';
const payload = { title: 'Entrada registada', body: 'Ana / Turno 09:00', receiverId: 1, tag: 'p-23', url: '/services/7?tab=team&day=2026-09-25&push=1' };

function environment(stored = new Map()) {
  const handlers = new Map(), notifications = [], navigations = [], opened = [], focused = [];
  const caches = {
    async open(name) {
      if (!stored.has(name)) stored.set(name, new Map());
      const records = stored.get(name);
      const key = (value) => new URL(typeof value === 'string' ? value : value.url, origin).href;
      return {
        async put(k, v) { records.set(key(k), v.clone()); },
        async match(k) { return records.get(key(k))?.clone(); },
        async delete(k) { return records.delete(key(k)); },
        async keys() { return [...records.keys()].map((url) => ({ url })); },
        async addAll() {},
      };
    },
    async keys() { return [...stored.keys()]; },
    async delete(name) { return stored.delete(name); },
  };
  let windows = [];
  const self = {
    location: { origin }, addEventListener(name, callback) { handlers.set(name, callback); },
    registration: { async showNotification(title, options) { notifications.push({ title, ...options }); } },
    clients: { async claim() {}, async matchAll() { return windows; }, async openWindow(url) { opened.push(url); } },
  };
  vm.runInNewContext(source, { self, caches, Response, URL, Date, console });
  async function fire(name, data) {
    let done;
    handlers.get(name)({ ...data, waitUntil(promise) { done = promise; } });
    await done;
  }
  return {
    stored, caches, notifications, opened, navigations, focused,
    owner: async (id) => (await caches.open('extrasolutio-push-settings')).put('/__push-owner', new Response(String(id))),
    push: (p = payload) => fire('push', { data: { json: () => p } }),
    click: (data = payload) => fire('notificationclick', { notification: { data, close() {} } }),
    activate: () => fire('activate', {}),
    window: () => { windows = [{ url: `${origin}/profile`, async navigate(url) { navigations.push(url); return { async focus() { focused.push(true); } }; } }]; },
  };
}

test('worker displays an opted-in notification with the real app icon', async () => {
  const e = environment(); await e.owner(1); await e.push();
  assert.equal(e.notifications.length, 1);
  assert.equal(e.notifications[0].icon, '/pwa-icons/icon-192-v6.png');
  assert.equal(e.notifications[0].body, payload.body);
  assert.equal(e.notifications[0].renotify, false);
});
test('simultaneous retries and worker restarts do not redisplay an already seen log', async () => {
  const e = environment(); await e.owner(1);
  await Promise.all([e.push(), e.push(), e.push()]); assert.equal(e.notifications.length, 1);
  const restarted = environment(e.stored); await restarted.push(); assert.equal(restarted.notifications.length, 0);
  await restarted.push({ ...payload, tag: 'p-24' }); assert.equal(restarted.notifications.length, 1);
});
test('worker does not show or open pushes belonging to a logged-out or different account', async () => {
  const e = environment(); await e.push(); assert.equal(e.notifications.length, 0);
  await e.owner(2); await e.push(); await e.click(); assert.equal(e.notifications.length, 0); assert.equal(e.opened.length, 0);
});
test('click focuses existing app at the service/day or opens it when closed', async () => {
  const e = environment(); await e.owner(1); await e.click();
  assert.deepEqual(e.opened, [origin + payload.url]);
  e.window(); await e.click(); assert.deepEqual(e.navigations, [origin + payload.url]); assert.equal(e.focused.length, 1);
});
test('external URLs and malformed tags are rejected; profile test notifications work', async () => {
  const e = environment(); await e.owner(1);
  for (const url of ['https://evil.test', '//evil.test', '/admin', '/services/7?next=evil']) { await e.push({ ...payload, url }); await e.click({ ...payload, url }); }
  await e.push({ ...payload, tag: '../../evil' });
  assert.equal(e.notifications.length, 0); assert.equal(e.opened.length, 0);
  await e.push({ ...payload, url: '/profile', tag: 't-test-123' }); assert.equal(e.notifications.length, 1);
});
test('worker activation preserves device preferences while removing obsolete app caches', async () => {
  const e = environment(); await e.owner(1); await e.caches.open('extrasolutio-pwa-v5');
  await e.activate();
  assert.ok(e.stored.has('extrasolutio-push-settings')); assert.ok(!e.stored.has('extrasolutio-pwa-v5'));
  await e.push(); assert.equal(e.notifications.length, 1);
});
