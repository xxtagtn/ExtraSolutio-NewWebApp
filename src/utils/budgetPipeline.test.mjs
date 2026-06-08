import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBudgetStatus, budgetStatusFlow } from './budgetPipeline.js';

test('removes the analysis step from the budget pipeline', () => {
  assert.deepEqual(budgetStatusFlow.map((item) => item.id), ['new_request', 'sent', 'accepted', 'lost']);
});

test('treats old analysis budgets as new requests', () => {
  assert.equal(normalizeBudgetStatus('analysis'), 'new_request');
  assert.equal(normalizeBudgetStatus('draft'), 'new_request');
  assert.equal(normalizeBudgetStatus('rejected'), 'lost');
});
