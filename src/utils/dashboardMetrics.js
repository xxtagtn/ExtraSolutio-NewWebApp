const realizedServiceStatuses = ['finalized', 'completed', 'invoiced', 'paid'];
const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function serviceEndDate(service) {
  return service?.isContinuous && service.endDate ? service.endDate : service?.date;
}

function itemDate(item) {
  return item?.date || item?.issueDate || item?.createdAt || '';
}

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterByFinancialPeriod(items, { month = '', year = '' } = {}, dateSelector = itemDate) {
  const selectedMonth = Number(month);
  const selectedYear = Number(year);

  return (items || []).filter((item) => {
    const date = validDate(dateSelector(item));
    if (!date) return false;
    if (month && date.getMonth() + 1 !== selectedMonth) return false;
    if (year && date.getFullYear() !== selectedYear) return false;
    return true;
  });
}

export function availableFinancialYears(...collections) {
  const years = new Set();
  collections.flat().forEach((item) => {
    const date = validDate(itemDate(item));
    if (date) years.add(date.getFullYear());
  });
  return [...years].sort((a, b) => b - a);
}

export function monthlyRevenueSeries(services, period = {}) {
  const filtered = filterByFinancialPeriod(services, period);
  const selectedMonth = Number(period.month);
  const indexes = period.month ? [selectedMonth - 1] : monthNames.map((_, index) => index);

  return indexes.map((index) => ({
    month: monthNames[index],
    receita: filtered
      .filter((service) => validDate(itemDate(service))?.getMonth() === index)
      .reduce((sum, service) => sum + Number(service.totalRevenue || 0), 0),
  }));
}

export function countRealizedServices(services, todayStart = new Date()) {
  return services.filter((service) => {
    if (service.status === 'cancelled') return false;
    if (realizedServiceStatuses.includes(service.status)) return true;

    const endDate = serviceEndDate(service);
    if (!endDate) return false;

    return new Date(dateOnly(endDate)) < todayStart;
  }).length;
}
