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
