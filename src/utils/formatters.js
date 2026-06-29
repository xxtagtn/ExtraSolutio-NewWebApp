export const money = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
});

export const date = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function asNumber(value) {
  return Number(value ?? 0);
}

export function durationHours(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  const totalMinutes = Math.max(0, Math.round((Number.isFinite(parsed) ? parsed : 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}h`;
}
