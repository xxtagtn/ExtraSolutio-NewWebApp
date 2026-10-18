export function clientPaymentTermDays(client) {
  const paymentTerm = String(client?.paymentTerm || '').trim().toLowerCase();
  if (paymentTerm === 'immediate') return 0;
  const fixed = { days_5: 5, days_15: 15, days_30: 30, days_45: 45 };
  if (Object.hasOwn(fixed, paymentTerm)) return fixed[paymentTerm];
  if (paymentTerm !== 'custom' || client?.paymentTermDays == null || String(client.paymentTermDays).trim() === '') return null;
  const customDays = Number(client.paymentTermDays);
  return Number.isInteger(customDays) && customDays >= 0 ? customDays : null;
}
