import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginateItems } from './pagination.js';

test('paginates items and reports the visible range', () => {
  const result = paginateItems(
    Array.from({ length: 37 }, (_, index) => index + 1),
    2,
    10,
  );

  assert.deepEqual(result.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 4);
  assert.equal(result.startItem, 11);
  assert.equal(result.endItem, 20);
  assert.deepEqual(result.pageNumbers, [1, 2, 3, 4]);
});

test('clamps the requested page after the collection becomes smaller', () => {
  const result = paginateItems(
    Array.from({ length: 12 }, (_, index) => index + 1),
    5,
    10,
  );

  assert.equal(result.currentPage, 2);
  assert.deepEqual(result.items, [11, 12]);
  assert.equal(result.startItem, 11);
  assert.equal(result.endItem, 12);
});

test('returns an empty pagination state for an empty collection', () => {
  const result = paginateItems([], 1, 20);

  assert.deepEqual(result.items, []);
  assert.equal(result.currentPage, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.startItem, 0);
  assert.equal(result.endItem, 0);
  assert.deepEqual(result.pageNumbers, [1]);
});

test('limits the numbered navigation around the current page', () => {
  const result = paginateItems(
    Array.from({ length: 200 }, (_, index) => index + 1),
    10,
    10,
  );

  assert.deepEqual(result.pageNumbers, [8, 9, 10, 11, 12]);
});
