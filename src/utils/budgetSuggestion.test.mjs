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

test('suggests the requested operational ratios for new service types', () => {
  const coffeeBreak = getBudgetSmartSuggestion({ guestsCount: 100, serviceType: 'coffee_break' });
  assert.equal(coffeeBreak.categories.find((item) => item.role === 'Emp.Mesa').qty, 5);

  const simpleBar = getBudgetSmartSuggestion({ guestsCount: 100, serviceType: 'bar_simples' });
  assert.equal(simpleBar.categories.find((item) => item.role === 'Barman').qty, 3);

  const cocktailBar = getBudgetSmartSuggestion({ guestsCount: 60, serviceType: 'bar_cocktails' });
  assert.equal(cocktailBar.categories.find((item) => item.role === 'Barman').qty, 3);
  assert.equal(cocktailBar.categories.find((item) => item.role === 'Barman de Apoio').qty, 1);

  const bbq = getBudgetSmartSuggestion({ guestsCount: 80, serviceType: 'bbq' });
  assert.equal(bbq.categories.find((item) => item.role === 'Churrasqueiro').qty, 1);
  assert.equal(bbq.categories.find((item) => item.role === 'Ajd.Cozinha').qty, 1);
});

test('adds a Chef de Sala when the suggested team exceeds ten people', () => {
  const suggestion = getBudgetSmartSuggestion({ guestsCount: 240, serviceType: 'buffet', eventLevel: 'normal' });
  assert.equal(suggestion.categories.find((item) => item.role === 'Chefe de Sala').qty, 1);
});

test('uses the defined stepped ratio for Copa Fina', () => {
  const atLimit = getBudgetSmartSuggestion({ guestsCount: 180, serviceType: 'buffet' });
  const nextBand = getBudgetSmartSuggestion({ guestsCount: 181, serviceType: 'buffet' });
  const largeEvent = getBudgetSmartSuggestion({ guestsCount: 561, serviceType: 'buffet' });

  assert.equal(atLimit.categories.find((item) => item.role === 'Copa Fina').qty, 2);
  assert.equal(nextBand.categories.find((item) => item.role === 'Copa Fina').qty, 3);
  assert.equal(largeEvent.categories.find((item) => item.role === 'Copa Fina').qty, 5);
});

test('suggests Logista only for operationally demanding services', () => {
  const buffet = getBudgetSmartSuggestion({ guestsCount: 200, serviceType: 'buffet' });
  const plated = getBudgetSmartSuggestion({ guestsCount: 125, serviceType: 'empratado' });
  const carving = getBudgetSmartSuggestion({ guestsCount: 225, serviceType: 'trinchar' });

  assert.equal(buffet.categories.some((item) => item.role === 'Logista'), false);
  assert.equal(plated.categories.find((item) => item.role === 'Logista').qty, 3);
  assert.equal(carving.categories.find((item) => item.role === 'Logista').qty, 5);
});
