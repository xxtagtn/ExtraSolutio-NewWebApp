import test from 'node:test';
import assert from 'node:assert/strict';

import { getBudgetSmartSuggestion } from './budgetSuggestion.js';

test('builds a smart suggestion from the event day guests and schedule', () => {
  const suggestion = getBudgetSmartSuggestion({
    guestsCount: '',
    serviceType: 'cocktail',
    eventLevel: 'premium',
    locationScope: 'outside_lisbon',
    eventDays: [
      { date: '2026-07-11', guestsCount: '0', startTime: '', endTime: '' },
      { date: '2026-07-12', guestsCount: '120', startTime: '18:00', endTime: '23:00' },
    ],
  });

  assert.ok(suggestion);
  assert.equal(suggestion.travelType, 'outside_lisbon');
  assert.ok(suggestion.notes.includes('120 convidados'));

  const tableRole = suggestion.categories.find((item) => item.role === 'Emp.Mesa');
  assert.equal(tableRole.qty, 5);
  assert.equal(tableRole.start, '18:00');
  assert.equal(tableRole.end, '23:00');

  const barmanRole = suggestion.categories.find((item) => item.role === 'Barman');
  assert.equal(barmanRole.qty, 3);

  const managerRole = suggestion.categories.find((item) => item.role === 'Chefe de Sala');
  assert.equal(managerRole.qty, 1);
  assert.equal(managerRole.start, '18:00');
  assert.equal(managerRole.end, '23:00');
});

test('does not build a smart suggestion without guest information', () => {
  assert.equal(getBudgetSmartSuggestion({ eventDays: [{ guestsCount: '' }] }), null);
});
