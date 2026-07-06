import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCollaboratorOptions } from './collaboratorSearch.js';

const collaborators = [
  { id: 1, shortName: 'Ana Rodrigues', name: 'Ana Carolina Rodrigues', nif: '111' },
  { id: 2, shortName: 'Miriam Oliveira', name: 'Miriam Peçanha Oliveira', nif: '222' },
  { id: 3, shortName: 'Carla Miriam', name: 'Carla Miriam Silva', nif: '333' },
  { id: 4, shortName: 'Miguel Santos', name: 'Miguel Santos', nif: '444' },
];

test('filters collaborator options as the user types', () => {
  assert.deepEqual(filterCollaboratorOptions(collaborators, 'Mir').map((item) => item.id), [2, 3]);
});

test('prioritizes collaborators whose name starts with the search text', () => {
  assert.deepEqual(filterCollaboratorOptions(collaborators, 'Mi').map((item) => item.id), [4, 2, 3]);
});

test('searches by nif without requiring an extra filter button', () => {
  assert.deepEqual(filterCollaboratorOptions(collaborators, '333').map((item) => item.id), [3]);
});
