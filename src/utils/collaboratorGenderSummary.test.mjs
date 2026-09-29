import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaboratorGenderSummary } from './collaboratorGenderSummary.js';

test('summarizes active collaborator gender groups and includes missing values in the total', () => {
  assert.deepEqual(buildCollaboratorGenderSummary([
    { gender: 'Feminino', _count: { id: 20 } },
    { gender: 'Masculino', _count: { id: 18 } },
    { gender: null, _count: { id: 3 } },
    { gender: '', _count: { id: 1 } },
  ]), {
    total: 42,
    women: 20,
    men: 18,
    other: 0,
    preferNot: 0,
    unspecified: 4,
  });
});

test('keeps other and prefer-not-to-say values separate', () => {
  assert.deepEqual(buildCollaboratorGenderSummary([
    { gender: 'Prefiro não indicar', _count: { id: 2 } },
    { gender: 'Outra identidade', _count: { id: 1 } },
  ]), {
    total: 3,
    women: 0,
    men: 0,
    other: 1,
    preferNot: 2,
    unspecified: 0,
  });
});

test('returns a zero summary when there are no active collaborators', () => {
  assert.deepEqual(buildCollaboratorGenderSummary(), {
    total: 0,
    women: 0,
    men: 0,
    other: 0,
    preferNot: 0,
    unspecified: 0,
  });
});
