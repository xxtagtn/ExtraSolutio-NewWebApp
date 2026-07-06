function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeValue(value[key]);
        return acc;
      }, {});
  }
  return value ?? '';
}

export function normalizeForDirtyCheck(value) {
  return JSON.stringify(normalizeValue(value));
}

export function formHasChanges(original, current) {
  return normalizeForDirtyCheck(original) !== normalizeForDirtyCheck(current);
}

export function confirmDiscardChanges(hasChanges, message = 'Existem alterações por guardar. Pretende sair sem guardar?') {
  if (!hasChanges) return true;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm(message);
}
