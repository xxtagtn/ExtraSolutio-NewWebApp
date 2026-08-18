import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collaboratorLightSelect,
  collaboratorSummarySelect,
  serviceListInclude,
} from './listPayloads.js';

test('collaborator light payload keeps photos out of list responses', () => {
  assert.equal(collaboratorLightSelect.photo, undefined);
  assert.equal(collaboratorLightSelect.name, true);
  assert.equal(collaboratorLightSelect.roles.orderBy.role, 'asc');
});

test('service list payload includes collaborators without photos', () => {
  const collaboratorSelect = serviceListInclude.assignments.include.collaborator.select;

  assert.equal(collaboratorSelect.photo, undefined);
  assert.equal(collaboratorSelect.name, true);
  assert.equal(collaboratorSelect.phone, true);
  assert.equal(collaboratorSelect.nif, true);
  assert.equal(collaboratorSelect.hourlyRate, true);
  assert.equal(collaboratorSelect.includeVat, true);
});

test('collaborator summary payload is enough for event assignment pickers', () => {
  assert.equal(collaboratorSummarySelect.photo, undefined);
  assert.equal(collaboratorSummarySelect.status, true);
  assert.equal(collaboratorSummarySelect.roles.orderBy.role, 'asc');
});
