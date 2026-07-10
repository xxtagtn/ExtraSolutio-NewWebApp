import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUserPhoto, userInitials } from './userProfile.js';

test('normalizes empty user photos to null', () => {
  assert.equal(normalizeUserPhoto(''), null);
  assert.equal(normalizeUserPhoto(null), null);
});

test('accepts compact image data urls for user photos', () => {
  const source = 'data:image/webp;base64,aGVsbG8=';

  assert.equal(normalizeUserPhoto(source), source);
});

test('rejects unsupported user photo values', () => {
  assert.throws(() => normalizeUserPhoto('https://example.test/photo.png'), /Imagem de utilizador inválida/);
  assert.throws(() => normalizeUserPhoto('data:image/svg+xml;base64,PHN2Zy8+'), /Imagem de utilizador inválida/);
});

test('builds readable initials from user name', () => {
  assert.equal(userInitials('Ana Carolina Rodrigues'), 'AC');
  assert.equal(userInitials('Administrador'), 'A');
});
