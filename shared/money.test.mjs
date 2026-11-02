import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateVatAmount, moneyCents, roundMoney, sumMoney } from './money.js';

test('monetary decimal ties round symmetrically without binary half-cent errors', () => {
  for (const [value, rounded] of [[1.005, 1.01], [2.675, 2.68], [224.595, 224.6], [14.835, 14.84],
    [47.515, 47.52], [0.005, 0.01], [0.0049, 0], [1.0049, 1], [1.0051, 1.01]]) {
    assert.equal(roundMoney(value), rounded);
    assert.equal(roundMoney(-value), rounded ? -rounded : 0);
  }
  assert.equal(roundMoney(1e-7), 0);
  assert.equal(roundMoney(1.005e3), 1005);
  assert.equal(moneyCents('976.50'), 97650);
  assert.equal(sumMoney(0.1, 0.2, -0.3), 0);
});

test('VAT rounds once from exact integer cents, including the reported 976.50 at 23 percent', () => {
  assert.equal(calculateVatAmount(976.5, 23), 224.6);
  assert.equal(sumMoney(976.5, calculateVatAmount(976.5, 23)), 1201.1);
  for (const [base, rate, tax] of [[0.5, 23, 0.12], [64.5, 23, 14.84], [365.5, 13, 47.52],
    [976.5, 0, 0], [100, 6, 6], [100, 13, 13], [100, 14.5, 14.5], [100, 6.25, 6.25],
    [9999999999.99, 23, 2300000000]]) {
    assert.equal(calculateVatAmount(base, rate), tax);
    assert.equal(calculateVatAmount(-base, rate), tax ? -tax : 0);
  }
});

test('VAT arithmetic matches an integer reference across every cent boundary in a representative range', () => {
  for (const rate of [0, 6, 13, 23, 14.5]) {
    const percentUnits = Math.round(rate * 100);
    for (let cents = 0; cents <= 100000; cents += 7) {
      const expected = Math.floor((cents * percentUnits + 5000) / 10000);
      assert.equal(moneyCents(calculateVatAmount(cents / 100, rate)), expected);
    }
  }
});

test('invalid or unsafe monetary values fail rather than lose precision silently', () => {
  for (const value of [NaN, Infinity, -Infinity, 'invalid', 1e20]) assert.throws(() => moneyCents(value), RangeError);
});
