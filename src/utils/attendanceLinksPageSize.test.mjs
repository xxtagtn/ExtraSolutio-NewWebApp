import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAttendanceLinksPageSize, readAttendanceLinksPageSize, saveAttendanceLinksPageSize } from './attendanceLinksPageSize.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('all available page sizes persist and can be restored after remount', () => {
  const storage = memoryStorage();
  assert.equal(readAttendanceLinksPageSize(1, storage), 25);
  for (const size of [10, 25, 50, 100]) {
    assert.equal(saveAttendanceLinksPageSize(1, size, storage), size);
    assert.equal(readAttendanceLinksPageSize(1, storage), size);
    assert.equal(normalizeAttendanceLinksPageSize(String(size)), size);
  }
});

test('preferences are scoped to the account and missing identities do not write', () => {
  const storage = memoryStorage();
  saveAttendanceLinksPageSize(1, 10, storage);
  assert.equal(readAttendanceLinksPageSize(2, storage), 25);
  saveAttendanceLinksPageSize(2, 100, storage);
  assert.equal(readAttendanceLinksPageSize(1, storage), 10);
  assert.equal(readAttendanceLinksPageSize(2, storage), 100);
  for (const id of [null, undefined, '', 'invalid', -1, 0]) {
    const fail = { setItem: () => assert.fail('Invalid accounts cannot store preferences') };
    saveAttendanceLinksPageSize(id, 50, fail);
    assert.equal(readAttendanceLinksPageSize(id, storage), 25);
  }
});

test('invalid or corrupted sizes fall back to 25', () => {
  for (const value of [null, undefined, '', 'broken', '{}', 0, -1, 15, 1000]) {
    assert.equal(normalizeAttendanceLinksPageSize(value), 25);
    assert.equal(readAttendanceLinksPageSize(1, { getItem: () => value }), 25);
  }
});

test('blocked storage never prevents pagination or exposes an error', () => {
  const storage = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
  assert.equal(readAttendanceLinksPageSize(1, storage), 25);
  assert.equal(saveAttendanceLinksPageSize(1, 10, storage), 10);
});
