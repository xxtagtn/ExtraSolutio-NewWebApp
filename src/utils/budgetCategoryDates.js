function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

export function budgetWorkDays(eventDays = []) {
  const byDate = new Map();
  (eventDays || []).forEach((day) => {
    const date = dateOnly(day?.date);
    if (date && !byDate.has(date)) {
      byDate.set(date, { ...day, date });
    }
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function shouldSelectBudgetCategoryDay(eventDays = []) {
  return budgetWorkDays(eventDays).length > 1;
}

export function normalizeBudgetCategoryDates(categories = [], eventDays = []) {
  const days = budgetWorkDays(eventDays);
  if (days.length <= 1) {
    const forcedDate = days[0]?.date || '';
    return (categories || []).map((category) => ({
      ...category,
      date: forcedDate,
    }));
  }

  return (categories || []).map((category) => ({
    ...category,
    date: dateOnly(category?.date),
  }));
}
