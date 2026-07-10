const USER_PHOTO_PATTERN = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_USER_PHOTO_LENGTH = 1_200_000;

export function normalizeUserPhoto(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (!USER_PHOTO_PATTERN.test(normalized) || normalized.length > MAX_USER_PHOTO_LENGTH) {
    throw new Error('Imagem de utilizador inválida. Usa JPG, PNG ou WEBP.');
  }
  return normalized;
}

export function userInitials(name = '') {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}
