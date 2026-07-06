import test from 'node:test';
import assert from 'node:assert/strict';

import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { requirePermission } from './permissions.js';

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('requirePermission permite quando a permissão existe', () => {
  const middleware = requirePermission(PERMISSIONS.CLIENTS_VIEW);
  const req = { user: { permissions: [PERMISSIONS.CLIENTS_VIEW] } };
  const res = responseRecorder();
  let called = false;

  middleware(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(res.statusCode, null);
});

test('requirePermission bloqueia quando a permissão não existe', () => {
  const middleware = requirePermission(PERMISSIONS.FINANCE_VIEW);
  const req = { user: { permissions: [PERMISSIONS.CLIENTS_VIEW] } };
  const res = responseRecorder();
  let called = false;

  middleware(req, res, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.payload.message, /permiss/i);
});
