export function localDayNumber(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDate();
}

export function filterRowsBySelectedDays(rows, selectedDays = []) {
  if (!selectedDays.length) return rows || [];
  const selected = new Set(selectedDays.map(Number));
  return (rows || []).filter((row) => selected.has(localDayNumber(row?.event?.date)));
}

function localDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterRowsByDateRange(rows, startDate, endDate) {
  const start = startDate || '';
  const end = endDate || '';
  return (rows || []).filter((row) => {
    const eventDate = localDateKey(row?.event?.date);
    if (!eventDate) return false;
    if (start && eventDate < start) return false;
    if (end && eventDate > end) return false;
    return true;
  });
}
