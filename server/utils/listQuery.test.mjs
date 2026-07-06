import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPaginatedPayload, parsePaginationQuery } from './listQuery.js';

test('leaves legacy list responses untouched when no pagination is requested', () => {
  const pagination = parsePaginationQuery({});

  assert.equal(pagination.enabled, false);
});

test('parses pagination query with safe bounds', () => {
  const pagination = parsePaginationQuery({ page: '3', pageSize: '500' }, { maxPageSize: 100 });

  assert.deepEqual(pagination, {
    enabled: true,
    page: 3,
    pageSize: 100,
    skip: 200,
    take: 100,
  });
});

test('builds a stable paginated payload', () => {
  assert.deepEqual(buildPaginatedPayload({
    items: [{ id: 1 }],
    total: 21,
    page: 2,
    pageSize: 10,
  }), {
    items: [{ id: 1 }],
    total: 21,
    page: 2,
    pageSize: 10,
    totalPages: 3,
  });
});
