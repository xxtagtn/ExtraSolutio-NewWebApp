function localDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function calendarDateKey(value) {
  const date = localDate(value);
  if (!date) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function calendarDateWithMonth(value, year, monthIndex) {
  const current = localDate(value) || new Date();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(current.getDate(), lastDay));
}

export function calendarInitialCursor(today = new Date()) {
  const current = localDate(today) || new Date();
  return new Date(current.getFullYear(), current.getMonth(), current.getDate());
}

export function calendarWeekDates(value) {
  const selected = localDate(value) || new Date();
  const mondayOffset = selected.getDay() === 0 ? -6 : 1 - selected.getDay();
  const monday = new Date(selected);
  monday.setDate(monday.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

export function serviceOccursOnDate(service, value) {
  const target = localDate(value);
  const start = localDate(service?.date);
  const end = localDate(service?.isContinuous && service?.endDate ? service.endDate : service?.date);
  if (!target || !start || !end) return false;
  return target >= start && target <= end;
}
