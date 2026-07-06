import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  invalidateApiCache,
  readApiCache,
  writeApiCache,
} from './apiCache.js';

test('stores and reads cached API responses by path', () => {
  invalidateApiCache();
  const payload = [{ id: 1, name: 'Cliente' }];

  writeApiCache('/clients', payload);

  assert.deepEqual(readApiCache('/clients'), payload);
});

test('invalidates all cached API responses after a mutation', () => {
  invalidateApiCache();
  writeApiCache('/clients', [{ id: 1 }]);
  writeApiCache('/services', [{ id: 2 }]);

  invalidateApiCache();

  assert.equal(readApiCache('/clients'), undefined);
  assert.equal(readApiCache('/services'), undefined);
});

test('invalidates cached API responses by prefix', () => {
  invalidateApiCache();
  writeApiCache('/clients', [{ id: 1 }]);
  writeApiCache('/clients/1', { id: 1 });
  writeApiCache('/services', [{ id: 2 }]);

  invalidateApiCache('/clients');

  assert.equal(readApiCache('/clients'), undefined);
  assert.equal(readApiCache('/clients/1'), undefined);
  assert.deepEqual(readApiCache('/services'), [{ id: 2 }]);
});
