const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDayValue(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = Date.UTC(year, month - 1, day);
  const parsed = new Date(result);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

export function documentExpiryAlert(expiryDate, today = new Date()) {
  const expiryDay = calendarDayValue(expiryDate);
  const todayDay = calendarDayValue(today);
  if (expiryDay === null || todayDay === null) return null;

  const days = Math.round((expiryDay - todayDay) / DAY_MS);
  if (days > 30) return null;

  if (days >= 0) {
    return {
      tone: 'orange',
      days,
      label: `Documento expira em ${days} dias`,
    };
  }

  return {
    tone: 'red',
    days,
    label: `Documento expirado há ${Math.abs(days)} dias`,
  };
}
