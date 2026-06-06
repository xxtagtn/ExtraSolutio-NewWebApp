export function normalizePaymentNotes(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function hasPaymentNotes(value) {
  return normalizePaymentNotes(value) !== null;
}
