// Round decimal amounts half away from zero, without binary multiplication at the cent boundary.
export function moneyCents(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) throw new RangeError('Invalid monetary amount.');
  const [coefficient, exponent = '0'] = String(Math.abs(numeric)).split('e');
  const cents = Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
  if (!Number.isSafeInteger(cents)) throw new RangeError('Monetary amount exceeds cent precision.');
  return cents === 0 ? 0 : Math.sign(numeric) * cents;
}

export function roundMoney(value) {
  return moneyCents(value) / 100;
}

export function sumMoney(...values) {
  const cents = values.reduce((sum, value) => sum + moneyCents(value), 0);
  if (!Number.isSafeInteger(cents)) throw new RangeError('Monetary sum exceeds cent precision.');
  return cents / 100;
}

export function calculateVatAmount(base, percent) {
  const numerator = BigInt(moneyCents(base)) * BigInt(moneyCents(percent));
  const absolute = numerator < 0n ? -numerator : numerator;
  // Both the base and percentage have two decimal places; round the resulting VAT to cents once.
  const cents = Number((absolute + 5000n) / 10000n);
  if (!Number.isSafeInteger(cents)) throw new RangeError('VAT exceeds cent precision.');
  return cents === 0 ? 0 : (numerator < 0n ? -cents : cents) / 100;
}
