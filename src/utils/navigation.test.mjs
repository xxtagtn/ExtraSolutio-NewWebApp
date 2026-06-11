import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BALANCETE_PATH,
  DEFAULT_AUTHENTICATED_PATH,
} from './navigation.js';

test('uses Dashboard as the first authenticated page', () => {
  assert.equal(DEFAULT_AUTHENTICATED_PATH, '/dashboard');
});

test('keeps Balancete on its own route', () => {
  assert.equal(BALANCETE_PATH, '/balancete');
});
