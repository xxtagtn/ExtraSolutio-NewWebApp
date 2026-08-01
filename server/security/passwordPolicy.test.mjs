import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePasswordStrength } from './passwordPolicy.js';

test('accepts a strong password', () => {
  assert.equal(validatePasswordStrength('ExtraSolutio!2026').valid, true);
});

test('rejects short or simple passwords', () => {
  assert.equal(validatePasswordStrength('abc').valid, false);
  assert.equal(validatePasswordStrength('extrasolutio2026').valid, false);
  assert.equal(validatePasswordStrength('ExtraSolutio').valid, false);
  assert.equal(validatePasswordStrength('ExtraSolutio2026').valid, false);
});

test('returns a user-facing message with the password requirements', () => {
  const result = validatePasswordStrength('abc');
  assert.equal(result.valid, false);
  assert.match(result.message, /12 caracteres/);
  assert.match(result.message, /mai\u00FAscula/i);
  assert.match(result.message, /s\u00EDmbolo/i);
});
