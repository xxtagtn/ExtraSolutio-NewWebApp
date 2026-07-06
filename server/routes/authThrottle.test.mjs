import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __loginThrottleForTests } from './auth.js';

test('blocks login attempts after the configured failure threshold', () => {
  const { createLoginThrottle } = __loginThrottleForTests;
  const throttle = createLoginThrottle({ windowMs: 60_000, maxFailures: 2, now: () => 1_000 });
  const key = '127.0.0.1|ana@example.com';

  assert.equal(throttle.isBlocked(key), false);
  throttle.registerFailure(key);
  assert.equal(throttle.isBlocked(key), false);
  throttle.registerFailure(key);
  assert.equal(throttle.isBlocked(key), true);
  throttle.clear(key);
  assert.equal(throttle.isBlocked(key), false);
});

test('resets login failure count when the window expires', () => {
  let now = 1_000;
  const { createLoginThrottle } = __loginThrottleForTests;
  const throttle = createLoginThrottle({ windowMs: 500, maxFailures: 2, now: () => now });
  const key = '127.0.0.1|ana@example.com';

  throttle.registerFailure(key);
  throttle.registerFailure(key);
  assert.equal(throttle.isBlocked(key), true);

  now = 2_000;
  assert.equal(throttle.isBlocked(key), false);
});
