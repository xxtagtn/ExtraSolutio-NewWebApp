import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePhotoDataUri } from './photoStorage.js';

test('parses supported collaborator photo data URIs', () => {
  const parsed = parsePhotoDataUri('data:image/png;base64,aGVsbG8=');

  assert.deepEqual(parsed, {
    mime: 'image/png',
    extension: 'png',
    base64: 'aGVsbG8=',
  });
});

test('rejects unsupported collaborator photo data URIs', () => {
  assert.equal(parsePhotoDataUri('data:image/svg+xml;base64,PHN2Zy8+'), null);
  assert.equal(parsePhotoDataUri('/uploads/collaborators/photo.png'), null);
});
