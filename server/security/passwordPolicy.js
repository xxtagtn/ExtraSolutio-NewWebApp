const PASSWORD_MIN_LENGTH = 12;

export function validatePasswordStrength(password) {
  const value = String(password || '');
  const failures = [];

  if (value.length < PASSWORD_MIN_LENGTH) failures.push('12 caracteres');
  if (!/[a-z]/.test(value)) failures.push('uma letra minúscula');
  if (!/[A-ZÀ-Ý]/.test(value)) failures.push('uma letra maiúscula');
  if (!/\d/.test(value)) failures.push('um número');
  if (!/[^A-Za-zÀ-ÿ0-9]/.test(value)) failures.push('um símbolo');

  if (failures.length === 0) return { valid: true, message: '' };

  return {
    valid: false,
    message: `A password deve ter pelo menos ${failures.join(', ')}.`,
  };
}
