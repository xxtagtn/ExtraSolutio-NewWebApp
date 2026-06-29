import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collaboratorPhotoSource,
  mergeCollaboratorDetail,
  shouldFetchCollaboratorDetail,
} from './collaboratorDetails.js';

test('uses the light row immediately while preserving full detail values when loaded', () => {
  const row = { id: 7, name: 'Ana', roles: ['Emp.Mesa'] };
  const detail = { id: 7, name: 'Ana Completa', photo: 'data:image/png;base64,abc' };

  assert.deepEqual(mergeCollaboratorDetail(row, null), row);
  assert.deepEqual(mergeCollaboratorDetail(row, detail), {
    id: 7,
    name: 'Ana Completa',
    roles: ['Emp.Mesa'],
    photo: 'data:image/png;base64,abc',
  });
});

test('fetches collaborator detail only until the photo state is known', () => {
  const lightRow = { id: 7, name: 'Ana' };

  assert.equal(shouldFetchCollaboratorDetail(lightRow, null, false), true);
  assert.equal(shouldFetchCollaboratorDetail(lightRow, null, true), false);
  assert.equal(shouldFetchCollaboratorDetail(lightRow, { id: 7, photo: null }, false), false);
  assert.equal(shouldFetchCollaboratorDetail({ ...lightRow, photo: 'local-photo' }, null, false), false);
});

test('resolves the photo from full detail before the light row', () => {
  assert.equal(collaboratorPhotoSource({ photo: 'old' }, { photo: 'new' }), 'new');
  assert.equal(collaboratorPhotoSource({ photo: 'old' }, null), 'old');
  assert.equal(collaboratorPhotoSource({}, { photo: null }), '');
});
