import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collaboratorRoleOptions } from './collaboratorRoles.js';

test('includes Corte de Presunto in the collaborator and event role catalog', () => {
  assert.ok(collaboratorRoleOptions.includes('Corte de Presunto'));
});

test('includes Trinchar in the collaborator and event role catalog', () => {
  assert.ok(collaboratorRoleOptions.includes('Trinchar'));
});

test('includes assistant-only operational roles in the catalog', () => {
  assert.ok(collaboratorRoleOptions.includes('Barman de Apoio'));
  assert.ok(collaboratorRoleOptions.includes('Churrasqueiro'));
});
