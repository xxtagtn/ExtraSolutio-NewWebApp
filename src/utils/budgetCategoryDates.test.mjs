import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  budgetWorkDays,
  normalizeBudgetCategoryDates,
  shouldSelectBudgetCategoryDay,
} from './budgetCategoryDates.js';

test('forces the only event day into every budget category', () => {
  const categories = [
    { role: 'Emp.Mesa', date: '' },
    { role: 'Barman', date: '2026-09-02' },
  ];
  const eventDays = [{ date: '2026-09-01' }];

  const normalized = normalizeBudgetCategoryDates(categories, eventDays);

  assert.equal(shouldSelectBudgetCategoryDay(eventDays), false);
  assert.deepEqual(normalized.map((item) => item.date), ['2026-09-01', '2026-09-01']);
});

test('keeps manual category dates when budget has several event days', () => {
  const categories = [
    { role: 'Emp.Mesa', date: '2026-09-01' },
    { role: 'Barman', date: '' },
  ];
  const eventDays = [
    { date: '2026-09-02' },
    { date: '2026-09-01' },
  ];

  const normalized = normalizeBudgetCategoryDates(categories, eventDays);

  assert.equal(shouldSelectBudgetCategoryDay(eventDays), true);
  assert.deepEqual(budgetWorkDays(eventDays).map((item) => item.date), ['2026-09-01', '2026-09-02']);
  assert.deepEqual(normalized.map((item) => item.date), ['2026-09-01', '']);
});

test('clears hidden stale category dates when no event day is selected yet', () => {
  const normalized = normalizeBudgetCategoryDates(
    [{ role: 'Copa Fina', date: '2026-09-01' }],
    [{ date: '' }],
  );

  assert.deepEqual(normalized.map((item) => item.date), ['']);
});
