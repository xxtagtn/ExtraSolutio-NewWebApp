import test from 'node:test';
import assert from 'node:assert/strict';
import { privatePhotoPath } from './privatePhotos.js';

test('private images use authenticated API paths without forwarding tokens to external origins', () => {
  const path = '/uploads/collaborators/collab-test.png';
  assert.equal(privatePhotoPath(path, '/api'), path);
  assert.equal(privatePhotoPath(`https://esgestao.ddns.net${path}`, '/api', 'https://esgestao.ddns.net'), path);
  assert.equal(privatePhotoPath(`http://localhost:3001${path}`, 'http://localhost:3001/api'), path);
  assert.equal(privatePhotoPath(`https://example.invalid${path}`, 'https://esgestao.ddns.net/api'), null);
  assert.equal(privatePhotoPath('data:image/png;base64,aGVsbG8=', '/api'), null);
  assert.equal(privatePhotoPath('blob:http://localhost/id', '/api'), null);
});
