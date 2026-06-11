const realizedServiceStatuses = ['finalized', 'completed', 'invoiced', 'paid'];

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function serviceEndDate(service) {
  return service?.isContinuous && service.endDate ? service.endDate : service?.date;
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
