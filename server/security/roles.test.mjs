import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAccessRole,
  canViewFinancialData,
  canViewSensitiveCollaboratorData,
  normalizeRole,
} from './roles.js';

test('normalizes supported and legacy roles', () => {
  assert.equal(normalizeRole('admin'), 'admin');
  assert.equal(normalizeRole('management'), 'management');
  assert.equal(normalizeRole('finance'), 'finance');
  assert.equal(normalizeRole('operations'), 'operations');
  assert.equal(normalizeRole('user'), 'operations');
  assert.equal(normalizeRole('unknown'), 'operations');
});

test('admin has access to every protected role', () => {
  assert.equal(canAccessRole({ role: 'admin' }, ['finance']), true);
  assert.equal(canAccessRole({ role: 'admin' }, ['operations']), true);
});

test('sensitive collaborator data is hidden from operations', () => {
  assert.equal(canViewSensitiveCollaboratorData({ role: 'operations' }), false);
  assert.equal(canViewSensitiveCollaboratorData({ role: 'user' }), false);
  assert.equal(canViewSensitiveCollaboratorData({ role: 'finance' }), true);
  assert.equal(canViewSensitiveCollaboratorData({ role: 'management' }), true);
});

test('financial data is limited to finance, management and admin', () => {
  assert.equal(canViewFinancialData({ role: 'operations' }), false);
  assert.equal(canViewFinancialData({ role: 'finance' }), true);
  assert.equal(canViewFinancialData({ role: 'management' }), true);
  assert.equal(canViewFinancialData({ role: 'admin' }), true);
});
