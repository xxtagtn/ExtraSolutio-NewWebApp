import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeExternalCosts } from './externalCosts.js';

test('preserves high precision margin percentages for external partner costs', () => {
  const [cost] = normalizeExternalCosts([
    {
      type: 'Catering',
      supplier: 'Parceiro A',
      costAmount: '100,00',
      marginPercent: '5.0921',
    },
  ]);

  assert.equal(cost.marginPercent, 5.0921);
  assert.equal(cost.marginAmount, 5.09);
  assert.equal(cost.chargeAmount, 105.09);
});
