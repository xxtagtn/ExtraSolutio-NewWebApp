import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { requireAuth } from './auth.js';

test('returns Login Expirado when the session token has expired', async () => {
  process.env.JWT_SECRET = 'test-secret';
  const expiredToken = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1s' });
  const req = { headers: { authorization: `Bearer ${expiredToken}` } };
  let statusCode = null;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { message: 'Login Expirado' });
});
