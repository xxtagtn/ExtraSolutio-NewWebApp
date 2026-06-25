export function sanitizeTimeInput(value) {
  return String(value || '')
    .replace(/[^\d:]/g, '')
    .slice(0, 5);
}

export function normalizeTimeInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  let hoursText = '';
  let minutesText = '';

  if (/^\d{1,2}$/.test(input)) {
    hoursText = input;
    minutesText = '00';
  } else if (/^\d{3,4}$/.test(input)) {
    hoursText = input.slice(0, -2);
    minutesText = input.slice(-2);
  } else {
    const match = input.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return input;
    [, hoursText, minutesText] = match;
    if (minutesText.length === 1) minutesText = `${minutesText}0`;
  }

  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return input;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isCompleteTimeInput(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return false;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
