function birthDateParts(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayMonthDay(parts, year) {
  if (parts.month === 2 && parts.day === 29 && !isLeapYear(year)) {
    return { month: 2, day: 28 };
  }
  return { month: parts.month, day: parts.day };
}

function collaboratorName(collaborator) {
  return collaborator?.shortName || collaborator?.name || `Colaborador #${collaborator?.id || ''}`.trim();
}

function birthdayEntry(collaborator, year) {
  const parts = birthDateParts(collaborator?.birthDate);
  if (!parts) return null;
  return {
    collaboratorId: collaborator.id,
    name: collaboratorName(collaborator),
    age: year - parts.year,
  };
}

function formatNameList(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export function birthdaysOnDate(collaborators, date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return (collaborators || [])
    .map((collaborator) => {
      const parts = birthDateParts(collaborator?.birthDate);
      if (!parts) return null;
      const annualDate = birthdayMonthDay(parts, year);
      if (annualDate.month !== month || annualDate.day !== day) return null;
      return birthdayEntry(collaborator, year);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }));
}

export function birthdaysByDayForMonth(collaborators, year, monthIndex) {
  const result = new Map();

  for (const collaborator of collaborators || []) {
    const parts = birthDateParts(collaborator?.birthDate);
    if (!parts) continue;
    const annualDate = birthdayMonthDay(parts, year);
    if (annualDate.month !== monthIndex + 1) continue;

    const list = result.get(annualDate.day) || [];
    list.push(birthdayEntry(collaborator, year));
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }));
    result.set(annualDate.day, list);
  }

  return result;
}

export function birthdayNotification(collaborators, today = new Date()) {
  const birthdays = birthdaysOnDate(collaborators, today);
  if (!birthdays.length) return null;

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return {
    id: `birthdays-${year}-${month}-${day}`,
    kind: 'birthday',
    title: birthdays.length === 1 ? '🎂 Hoje faz anos' : '🎂 Hoje fazem anos',
    subtitle: formatNameList(birthdays.map((birthday) => birthday.name)),
    dueDate: new Date(year, today.getMonth(), today.getDate()),
  };
}
