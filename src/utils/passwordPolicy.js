export const PASSWORD_MIN_LENGTH = 12;

export function validatePasswordStrength(password) {
  const value = String(password || '');
  const failures = [];

  if (value.length < PASSWORD_MIN_LENGTH) failures.push(`${PASSWORD_MIN_LENGTH} caracteres`);
  if (!/[a-z]/.test(value)) failures.push('uma letra min\u00FAscula');
  if (!/[A-ZÀ-Ý]/.test(value)) failures.push('uma letra mai\u00FAscula');
  if (!/\d/.test(value)) failures.push('um n\u00FAmero');
  if (!/[^A-Za-zÀ-ÿ0-9]/.test(value)) failures.push('um s\u00EDmbolo');

  if (failures.length === 0) return { valid: true, message: '' };

  return {
    valid: false,
    message: `A password deve ter pelo menos ${failures.join(', ')}.`,
  };
}
