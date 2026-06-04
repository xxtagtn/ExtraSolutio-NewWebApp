import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTravelAmount } from './travelCalculator.js';

test('does not charge travel when no travel mode is selected', () => {
  assert.equal(calculateTravelAmount({ travelType: 'none' }), 0);
});

test('charges the fixed outside Lisbon amount', () => {
  assert.equal(calculateTravelAmount({ travelType: 'outside_lisbon' }), 35);
});

test('charges the fixed outside Lisbon amount plus the selected staff', () => {
  assert.equal(calculateTravelAmount({ travelType: 'outside_plus_staff', travelPeople: 3 }), 65);
});

test('calculates kilometers and travel time', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
  }), 100);
});

test('applies 50/50 only to the travel time amount', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    split5050: true,
  }), 70);
});

test('uses a direct custom amount in manual mode', () => {
  assert.equal(calculateTravelAmount({ travelType: 'manual', travelManualAmount: '87,50€' }), 87.5);
});

test('does not preserve the removed automatic mode', () => {
  assert.equal(calculateTravelAmount({ travelType: 'automatic', locationScope: 'outside_lisbon' }), 0);
});
