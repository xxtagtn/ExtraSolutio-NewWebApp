import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, refreshStoredAuth } from './api.js';
import { ACTIVITY_KEY, AUTH_KEY, IDLE_TIMEOUT_MS, clearStoredAuth, getStoredAuth, isSessionExpiredError, lastActivityAt, sessionExpired, setStoredAuth, startSessionMonitor, subscribeAuth, validStoredAuth } from './authSession.js';
import { readApiCache, writeApiCache } from './apiCache.js';

const minute = 60000;
const token = (now, ttl = 60 * minute, suffix = '') => `header.${Buffer.from(JSON.stringify({ iat: now / 1000, exp: (now + ttl) / 1000 })).toString('base64url')}.signature${suffix}`;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup(t) {
  let now = Date.UTC(2026, 8, 24, 10);
  let sequence = 0;
  const values = new Map();
  const timers = new Map();
  const handlers = new Map();
  const stops = [];
  t.after(() => { for (const stop of stops) stop(); });
  const surface = {
    addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    window: surface, document: surface,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  t.mock.method(Date, 'now', () => now);
  const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
  const env = {
    now: () => now, values, timers,
    login(ttl = 60 * minute) { return setStoredAuth({ token: token(now, ttl), user: { id: 1, role: 'operations', permissions: ['communication.view'] } }); },
    emit(type, extra = {}) { for (const fn of handlers.get(type) || []) fn({ isTrusted: true, ...extra }); },
    async advance(ms) {
      const end = now + ms;
      let iterations = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++iterations < 1000, 'Timer must not loop');
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
    jump(ms) { now += ms; },
    monitor(refresh = refreshStoredAuth) { const stop = startSessionMonitor(refresh); stops.push(stop); return stop; },
  };
  return env;
}

test('one hour of inactivity clears auth/cache, even while background requests renew JWT', async (t) => {
  const env = setup(t);
  const initial = env.login();
  t.mock.method(globalThis, 'fetch', async (url) => response(200, url.endsWith('/refresh') ? { token: token(env.now()), user: initial.user } : []));
  let invalidations = 0;
  const unsubscribe = subscribeAuth(() => { if (!getStoredAuth()) invalidations++; });
  t.after(unsubscribe);
  writeApiCache('/private', { secret: true });
  env.monitor();
  for (let i = 0; i < 59; i++) { await env.advance(minute); await api('/notifications'); }
  assert.ok(getStoredAuth());
  assert.equal(lastActivityAt(getStoredAuth()), initial.lastActivityAt);
  await env.advance(minute - 1);
  assert.ok(getStoredAuth());
  await env.advance(1);
  assert.equal(getStoredAuth(), null);
  assert.equal(env.values.has(ACTIVITY_KEY), false);
  assert.equal(readApiCache('/private'), undefined);
  assert.equal(invalidations, 1);
  assert.equal(IDLE_TIMEOUT_MS, 3600000);
});

test('10:00 login, activity 10:30 and 11:15 expires at 12:15, not at fixed token expiry', async (t) => {
  const env = setup(t);
  const auth = env.login();
  let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async () => { refreshes++; return response(200, { token: token(env.now()), user: auth.user }); });
  env.monitor();
  await env.advance(30 * minute);
  env.emit('keydown');
  await env.advance(45 * minute);
  assert.ok(getStoredAuth());
  env.emit('pointerdown');
  const activeAt = env.now();
  await env.advance(60 * minute - 1);
  assert.ok(getStoredAuth());
  assert.equal(lastActivityAt(getStoredAuth()), activeAt);
  assert.deepEqual(getStoredAuth().user, auth.user);
  assert.ok(refreshes >= 2);
  await env.advance(1);
  assert.equal(getStoredAuth(), null);
});

test('sleep/reopen, reload and activity after the deadline cannot resurrect an expired session', async (t) => {
  const env = setup(t);
  env.login(4 * 60 * minute);
  env.monitor();
  env.jump(61 * minute);
  env.emit('pointerdown');
  assert.equal(getStoredAuth(), null);
  env.login(4 * 60 * minute);
  env.jump(61 * minute);
  assert.equal(validStoredAuth(), null);
});

test('another tab shares activity but focus, polling and synthetic events are not activity', async (t) => {
  const env = setup(t);
  const auth = env.login(4 * 60 * minute);
  env.monitor();
  await env.advance(59 * minute);
  env.emit('focus');
  env.emit('pointerdown', { isTrusted: false });
  assert.equal(lastActivityAt(auth), auth.lastActivityAt);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ sessionId: auth.sessionId, at: env.now() }));
  env.emit('storage', { key: ACTIVITY_KEY });
  await env.advance(59 * minute);
  assert.ok(getStoredAuth());
  await env.advance(minute);
  assert.equal(getStoredAuth(), null);
});

test('simultaneous 401 responses invalidate once and never affect a later login', async (t) => {
  const env = setup(t);
  env.login();
  let clears = 0;
  const stop = subscribeAuth(() => { if (!getStoredAuth()) clears++; });
  t.after(stop);
  const delayed = deferred();
  t.mock.method(globalThis, 'fetch', () => delayed.promise);
  const requests = [api('/one'), api('/two'), api('/three')];
  delayed.resolve(response(401, { message: 'Login Expirado' }));
  const results = await Promise.allSettled(requests);
  assert.ok(results.every((result) => isSessionExpiredError(result.reason)));
  assert.equal(clears, 1);
  assert.equal(getStoredAuth(), null);
  env.login();
  const late = deferred();
  t.mock.method(globalThis, 'fetch', () => late.promise);
  const pending = api('/old');
  clearStoredAuth();
  const fresh = env.login(); // A login in the same second can have an identical JWT.
  late.resolve(response(401, {}));
  await assert.rejects(pending, isSessionExpiredError);
  assert.equal(getStoredAuth().sessionId, fresh.sessionId);
});

test('concurrent refresh is single-flight and preserves the latest activity', async (t) => {
  const env = setup(t);
  env.login();
  const delayed = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return delayed.promise; });
  const first = refreshStoredAuth();
  const second = refreshStoredAuth();
  const auth = getStoredAuth();
  env.jump(minute);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ sessionId: auth.sessionId, at: env.now() }));
  delayed.resolve(response(200, { token: token(env.now()), user: auth.user }));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(lastActivityAt(getStoredAuth()), env.now());
  assert.equal(getStoredAuth().sessionId, auth.sessionId);
});

test('a late refresh cannot restore logout, overwrite new login or extend idle expiry', async (t) => {
  const env = setup(t);
  for (const mode of ['logout', 'new-login', 'idle']) {
    const old = env.login(4 * 60 * minute);
    const delayed = deferred();
    t.mock.method(globalThis, 'fetch', () => delayed.promise);
    const pending = refreshStoredAuth();
    if (mode === 'idle') env.jump(61 * minute);
    else clearStoredAuth();
    const fresh = mode === 'new-login' ? env.login() : null;
    delayed.resolve(response(200, { token: token(env.now()), user: old.user }));
    await assert.rejects(pending, isSessionExpiredError);
    assert.equal(getStoredAuth()?.sessionId ?? null, fresh?.sessionId ?? null);
  }
});

test('permission 403, incorrect credentials/password, network and 500 do not log out a valid session', async (t) => {
  const env = setup(t);
  const auth = env.login();
  for (const [path, status, message] of [
    ['/restricted', 403, 'Sem permissões'], ['/auth/login', 401, 'Credenciais inválidas.'],
    ['/auth/password', 401, 'Password atual invalida.'], ['/server-error', 500, 'Erro interno'],
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response(status, { message }));
    await assert.rejects(api(path), (error) => error.message === message && !isSessionExpiredError(error));
    assert.equal(getStoredAuth().sessionId, auth.sessionId);
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network unavailable'); });
  await assert.rejects(refreshStoredAuth(), /Network/);
  assert.equal(getStoredAuth().sessionId, auth.sessionId);
});

test('invalid credentials never attach a previous token; successful login starts a fresh idle period', async (t) => {
  const env = setup(t);
  const original = env.login();
  env.jump(61 * minute);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return response(200, { token: token(env.now()), user: original.user });
  });
  const auth = setStoredAuth(await api('/auth/login', { method: 'POST' }));
  assert.notEqual(auth.sessionId, original.sessionId);
  assert.equal(sessionExpired(auth), false);
  assert.equal(lastActivityAt(auth), env.now());
});

test('legacy storage gets one timestamp, not a new inactivity window on every read', (t) => {
  const env = setup(t);
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token: token(env.now(), 4 * 60 * minute), user: { id: 1 } }));
  const first = getStoredAuth();
  env.jump(61 * minute);
  assert.equal(getStoredAuth().lastActivityAt, first.lastActivityAt);
  assert.equal(validStoredAuth(), null);
});
