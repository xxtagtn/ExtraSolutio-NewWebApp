import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPwaServiceWorker, shouldRegisterPwaServiceWorker } from './pwaRegistration.js';

test('does not register the service worker outside production', async () => {
  let calls = 0;
  const result = await registerPwaServiceWorker({
    prod: false,
    windowRef: {
      addEventListener(eventName, callback) {
        calls += 1;
        callback();
      },
    },
    navigatorRef: {
      serviceWorker: {
        register() {
          calls += 1;
        },
      },
    },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(calls, 0);
});

test('requires service worker support before registering', () => {
  assert.equal(shouldRegisterPwaServiceWorker({ prod: true, navigatorRef: {} }), false);
  assert.equal(
    shouldRegisterPwaServiceWorker({
      prod: true,
      navigatorRef: { serviceWorker: { register() {} } },
    }),
    true,
  );
});

test('registers the production service worker after window load', async () => {
  let loadCallback;
  let registeredUrl = '';
  let registeredOptions = null;

  const result = await registerPwaServiceWorker({
    prod: true,
    windowRef: {
      addEventListener(eventName, callback) {
        assert.equal(eventName, 'load');
        loadCallback = callback;
      },
    },
    navigatorRef: {
      serviceWorker: {
        async register(url, options) {
          registeredUrl = url;
          registeredOptions = options;
          return { scope: options.scope };
        },
      },
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(registeredUrl, '');

  await loadCallback();

  assert.equal(registeredUrl, '/service-worker.js?v=5');
  assert.deepEqual(registeredOptions, { scope: '/', updateViaCache: 'none' });
});
