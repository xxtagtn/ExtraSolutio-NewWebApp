export const SEASONAL_THEMES = [
  { value: 'original', label: 'Original' },
  { value: 'halloween', label: 'Halloween' },
  { value: 'christmas', label: 'Natal' },
  { value: 'easter', label: 'Páscoa' },
  { value: 'automatic', label: 'Automático' },
];

export function normalizeThemePreference(value) {
  return SEASONAL_THEMES.some((theme) => theme.value === value) ? value : 'original';
}

export function themePreferenceKey(userId) {
  return userId === undefined || userId === null || userId === '' ? null : `extrasolutio.appearance.theme:${userId}`;
}

export function readThemePreference(userId, storage) {
  const key = themePreferenceKey(userId);
  if (!key) return 'original';
  try {
    return normalizeThemePreference((storage || globalThis.localStorage).getItem(key));
  } catch {
    return 'original';
  }
}

export function saveThemePreference(userId, value, storage) {
  const key = themePreferenceKey(userId);
  if (!key) return false;
  try {
    (storage || globalThis.localStorage).setItem(key, normalizeThemePreference(value));
    return true;
  } catch {
    return false;
  }
}

// Gregorian computus; date-only UTC arithmetic avoids daylight-saving shifts.
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function automaticSeasonalTheme(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return 'original';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(date).map(({ type, value }) => [type, Number(value)]));
  const { year, month, day } = parts;
  if ((month === 10 && day >= 25) || (month === 11 && day <= 2)) return 'halloween';
  if (month === 12 || (month === 1 && day <= 6)) return 'christmas';
  const daysFromEaster = (Date.UTC(year, month - 1, day) - easterSunday(year).getTime()) / 86400000;
  return daysFromEaster >= -7 && daysFromEaster <= 1 ? 'easter' : 'original';
}

export function resolveSeasonalTheme(preference, now = new Date()) {
  const selected = normalizeThemePreference(preference);
  return selected === 'automatic' ? automaticSeasonalTheme(now) : selected;
}

export function seasonalThemeLabel(theme) {
  return SEASONAL_THEMES.find(({ value }) => value === theme)?.label || 'Original';
}
