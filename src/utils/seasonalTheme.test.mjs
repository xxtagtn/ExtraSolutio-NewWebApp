import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSeasonalTheme, easterSunday, normalizeThemePreference, readThemePreference, resolveSeasonalTheme, saveThemePreference, seasonalThemeLabel, themePreferenceKey } from './seasonalTheme.js';

for (const [day, expected] of [
  ['2026-10-24', 'original'], ['2026-10-25', 'halloween'], ['2026-10-31', 'halloween'],
  ['2026-11-02', 'halloween'], ['2026-11-03', 'original'], ['2026-11-30', 'original'],
  ['2026-12-01', 'christmas'], ['2026-12-31', 'christmas'], ['2027-01-01', 'christmas'],
  ['2027-01-06', 'christmas'], ['2027-01-07', 'original'],
  ['2026-03-28', 'original'], ['2026-03-29', 'easter'], ['2026-04-05', 'easter'],
  ['2026-04-06', 'easter'], ['2026-04-07', 'original'],
  ['2027-03-20', 'original'], ['2027-03-21', 'easter'], ['2027-03-29', 'easter'], ['2027-03-30', 'original'],
]) {
  test(`automatic theme on ${day}: ${expected}`, () => {
    assert.equal(automaticSeasonalTheme(`${day}T12:00:00Z`), expected);
    assert.equal(resolveSeasonalTheme('automatic', `${day}T12:00:00Z`), expected);
  });
}

test('automatic calendar uses Lisbon rather than UTC or device timezone', () => {
  assert.equal(automaticSeasonalTheme('2026-10-24T22:59:59Z'), 'original');
  assert.equal(automaticSeasonalTheme('2026-10-24T23:00:00Z'), 'halloween');
  assert.equal(automaticSeasonalTheme('2026-11-02T23:59:59Z'), 'halloween');
  assert.equal(automaticSeasonalTheme('2026-11-03T00:00:00Z'), 'original');
  assert.equal(automaticSeasonalTheme('2026-12-31T21:00:00-03:00'), 'christmas');
  assert.equal(automaticSeasonalTheme('not a date'), 'original');
});

test('Gregorian Easter covers different years and century corrections', () => {
  for (const [year, day] of [[2000, '04-23'], [2024, '03-31'], [2025, '04-20'], [2026, '04-05'],
    [2027, '03-28'], [2028, '04-16'], [2029, '04-01'], [2030, '04-21'], [2100, '03-28']]) {
    const result = easterSunday(year);
    assert.equal(result.toISOString().slice(0, 10), `${year}-${day}`);
    assert.equal(result.getUTCDay(), 0);
  }
});

test('manual choices never change automatically and unknown data falls back safely', () => {
  for (const choice of ['original', 'halloween', 'christmas', 'easter']) {
    assert.equal(resolveSeasonalTheme(choice, '2026-07-01'), choice);
    assert.equal(resolveSeasonalTheme(choice, '2026-12-25'), choice);
  }
  for (const value of [null, undefined, {}, 'invalid', '<script>', 'Christmas']) {
    assert.equal(normalizeThemePreference(value), 'original');
    assert.equal(resolveSeasonalTheme(value), 'original');
  }
  assert.equal(seasonalThemeLabel('easter'), 'Páscoa');
});

test('preference persists separately for each user without changing other browser data', () => {
  const items = new Map([['extrasolutio.auth', 'unchanged']]);
  const storage = { getItem: (key) => items.get(key), setItem: (key, value) => items.set(key, value) };
  assert.equal(readThemePreference(1, storage), 'original');
  assert.equal(saveThemePreference(1, 'halloween', storage), true);
  assert.equal(saveThemePreference(2, 'christmas', storage), true);
  assert.equal(readThemePreference(1, storage), 'halloween');
  assert.equal(readThemePreference(2, storage), 'christmas');
  assert.equal(readThemePreference(3, storage), 'original');
  assert.equal(items.get('extrasolutio.auth'), 'unchanged');
  assert.equal(saveThemePreference(1, 'original', storage), true);
  assert.equal(readThemePreference(1, storage), 'original');
  items.set(themePreferenceKey(1), 'corrupt');
  assert.equal(readThemePreference(1, storage), 'original');
  assert.equal(themePreferenceKey(null), null);
  assert.equal(readThemePreference(null, storage), 'original');
  assert.equal(saveThemePreference(null, 'christmas', storage), false);
});

test('blocked or full storage does not break appearance controls', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readThemePreference(1, blocked), 'original');
  assert.equal(saveThemePreference(1, 'halloween', blocked), false);
});
