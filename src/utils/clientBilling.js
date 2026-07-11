function selectedPeriodParts(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : new Date().getMonth() + 1,
  };
}

function startOfLocalDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(value, days) {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function monthPeriodLabel(value) {
  return new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function paymentTermDays(client) {
  if (client?.paymentTerm === 'immediate') return 0;
  if (client?.paymentTerm === 'days_15') return 15;
  if (client?.paymentTerm === 'days_30') return 30;
  if (client?.paymentTerm === 'days_45') return 45;
  if (client?.paymentTerm === 'custom') return Number(client.paymentTermDays || 0);
  return 30;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOpenService(service) {
  return ['invoiced', 'paid', 'partial70'].includes(String(service?.billingStatus || ''));
}

function firstActionableService(services) {
  return (services || []).find((service) => ['pending', 'partial70', 'paid', 'invoiced'].includes(String(service?.billingStatus || '')))
    || services?.[0]
    || null;
}

function serviceValue(service) {
  return num(service?.financial?.receivable || service?.financial?.revenue || 0);
}

function rowBillingServices(row) {
  const groupedServices = (row?.billingGroups || []).flatMap((group) => group.events || []);
  return groupedServices.length ? groupedServices : row?.nonInvoicedServices || [];
}

function serviceMatchesBillingGroup(service, group, fallbackMethod) {
  if (!service?.date || !group) return false;
  const method = group.method || fallbackMethod || 'per_event';
  const serviceDate = new Date(service.date);
  const issueDate = new Date(group.issueDate || group.dueDate || service.date);
  if (Number.isNaN(serviceDate.getTime()) || Number.isNaN(issueDate.getTime())) return false;

  if (method === 'monthly' || method === 'custom') {
    return serviceDate.getFullYear() === issueDate.getFullYear()
      && serviceDate.getMonth() === issueDate.getMonth();
  }

  if (method === 'biweekly') {
    const serviceHalf = serviceDate.getDate() <= 15 ? 1 : 2;
    const issueHalf = issueDate.getDate() <= 15 ? 1 : 2;
    return serviceDate.getFullYear() === issueDate.getFullYear()
      && serviceDate.getMonth() === issueDate.getMonth()
      && serviceHalf === issueHalf;
  }

  return (group.events || []).some((event) => Number(event.id) === Number(service.id));
}

function mergeStandaloneServicesIntoGroups(groups, services, billingMethod) {
  if (!groups.length || !services.length) return groups;

  const result = groups.map((group) => ({
    ...group,
    events: [...(group.events || [])],
    total: num(group.total),
  }));

  for (const service of services) {
    if (!service?.id) continue;
    const alreadyGrouped = result.some((group) => (
      (group.events || []).some((event) => Number(event.id) === Number(service.id))
    ));
    if (alreadyGrouped) continue;

    const target = result.find((group) => serviceMatchesBillingGroup(service, group, billingMethod));
    if (!target) continue;

    target.events.push(service);
    target.total += serviceValue(service);
  }

  return result;
}

function standaloneGroupInfoForService(row, service) {
  const client = row || {};
  const method = client.billingMethod || 'per_event';
  const d = new Date(service.date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  if (method === 'monthly') {
    return {
      key: `${client.id}:monthly:${year}-${month}`,
      label: `${client.name || 'Cliente'} · ${monthPeriodLabel(d)}`,
      issueDate: lastDayOfMonth(year, month),
      method,
    };
  }

  if (method === 'biweekly') {
    const half = day <= 15 ? 1 : 2;
    return {
      key: `${client.id}:biweekly:${year}-${month}:${half}`,
      label: `${client.name || 'Cliente'} · ${half === 1 ? '1. quinzena' : '2. quinzena'} ${monthPeriodLabel(d)}`,
      issueDate: half === 1 ? new Date(year, month, 15) : lastDayOfMonth(year, month),
      method,
    };
  }

  if (method === 'custom') {
    return {
      key: `${client.id}:custom:${year}-${month}`,
      label: `${client.name || 'Cliente'} · ${client.billingCustomRule || monthPeriodLabel(d)}`,
      issueDate: lastDayOfMonth(year, month),
      method,
    };
  }

  return {
    key: `${client.id}:${method}:${service.id}`,
    label: `${client.name || 'Cliente'} · ${service.name || 'Evento/Serviço'}`,
    issueDate: method === 'prepaid' ? new Date() : addDays(d, 1),
    method,
  };
}

function buildStandaloneServiceGroups(row, services) {
  const groups = new Map();
  for (const service of services || []) {
    if (!service?.id || !service?.date) continue;
    const info = standaloneGroupInfoForService(row, service);
    const current = groups.get(info.key) || {
      key: info.key,
      client: row,
      method: info.method,
      label: info.label,
      issueDate: info.issueDate,
      dueDate: null,
      events: [],
      total: 0,
    };
    current.events.push(service);
    current.total += serviceValue(service);
    current.dueDate = dueDateForBillingGroup(current);
    groups.set(info.key, current);
  }
  return [...groups.values()].sort((a, b) => new Date(a.issueDate || 0).getTime() - new Date(b.issueDate || 0).getTime());
}

export function billingEventIdsForRow(row) {
  const ids = new Set();
  for (const group of row?.billingGroups || []) {
    for (const event of group.events || []) {
      if (event?.id) ids.add(Number(event.id));
    }
  }
  if (!ids.size) {
    for (const service of row?.nonInvoicedServices || []) {
      if (service?.id) ids.add(Number(service.id));
    }
  }
  return [...ids];
}

export function billingStatusForRow(row) {
  const services = rowBillingServices(row);
  const statuses = services.map((service) => String(service?.billingStatus || 'pending'));
  if (!statuses.length) return 'pending';
  if (statuses.every((status) => status === statuses[0])) return statuses[0];
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('partial70')) return 'partial70';
  if (statuses.includes('invoiced')) return 'invoiced';
  if (statuses.includes('paid')) return 'paid';
  return statuses[0];
}

export function billingValueForRow(row) {
  const serviceTotal = rowBillingServices(row).reduce((sum, service) => sum + serviceValue(service), 0);
  if (serviceTotal > 0) return serviceTotal;

  const groupTotal = (row?.billingGroups || []).reduce((sum, group) => sum + num(group.total), 0);
  if (groupTotal > 0) return groupTotal;

  return num(row?.totalOpen || row?.pendingBilling || row?.invoiceDebt);
}

export function billingPaymentDateForRow(row) {
  const dates = rowBillingServices(row)
    .map((service) => (service?.billingPaymentDate ? new Date(service.billingPaymentDate) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0] || null;
}

export function splitClientBillingRows(rows) {
  return (rows || []).reduce((result, row) => {
    const hasServiceEvents = billingEventIdsForRow(row).length > 0;
    const isArchived = hasServiceEvents && billingStatusForRow(row) === 'paid';
    if (isArchived) {
      result.archivedRows.push(row);
    } else {
      result.activeRows.push(row);
    }
    return result;
  }, { activeRows: [], archivedRows: [] });
}

export function clientBillingRowsForActiveEvents(rows) {
  return (rows || [])
    .filter((row) => billingEventIdsForRow(row).length > 0)
    .sort((a, b) => {
      const byName = String(a?.name || '').localeCompare(String(b?.name || ''), 'pt');
      if (byName) return byName;
      return new Date(a?.nextDueDate || 0).getTime() - new Date(b?.nextDueDate || 0).getTime();
    });
}

export function isDateInBillingPeriod(value, period) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  const { year, month } = selectedPeriodParts(period);
  if (month === 0) return d.getFullYear() === year;
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

export function billingGroupMatchesPeriod(group, period) {
  if (!group) return false;
  if (isDateInBillingPeriod(group.issueDate, period)) return true;
  return (group.events || []).some((event) => isDateInBillingPeriod(event.date, period));
}

export function filterBillingGroupsByPeriod(groups, period) {
  return (groups || []).filter((group) => billingGroupMatchesPeriod(group, period));
}

export function filterServicesByPeriod(services, period) {
  return (services || []).filter((service) => {
    const dates = [service.date, service.endDate, ...(service.assignments || []).map((assignment) => assignment.assignmentDate)];
    return dates.some((value) => isDateInBillingPeriod(value, period));
  });
}

export function filterInvoicesByPeriod(invoices, period) {
  return (invoices || []).filter((invoice) => (
    isDateInBillingPeriod(invoice.issueDate, period)
    || isDateInBillingPeriod(invoice.dueDate, period)
  ));
}

export function dueDateForBillingGroup(group, today = new Date()) {
  if (!group?.issueDate) return null;

  if (group.method === 'prepaid') {
    const eventDate = startOfLocalDay(group.events?.[0]?.date || group.issueDate);
    const currentDay = startOfLocalDay(today);
    return eventDate < currentDay ? currentDay : eventDate;
  }

  const issueDate = startOfLocalDay(group.issueDate);
  if (group.method === 'monthly' || group.method === 'biweekly') return issueDate;
  return addDays(issueDate, paymentTermDays(group.client));
}

export function expandClientBillingRows(row, options = {}) {
  const services = row?.nonInvoicedServices || [];
  let groups = mergeStandaloneServicesIntoGroups(
    row?.billingGroups || [],
    services,
    row?.billingMethod,
  );
  const invoices = row?.invoices || [];
  const overdueDaysFromDate = options.overdueDaysFromDate || (() => 0);

  if (!groups.length && services.length) {
    groups = buildStandaloneServiceGroups(row, services);
  }

  if (!groups.length) {
    return [{
      ...row,
      rowId: row?.rowId || `client:${row?.id || 'unknown'}:summary`,
      billingPeriodLabel: row?.billingPeriodLabel || 'Período selecionado',
    }];
  }

  const groupedEventIds = new Set(groups.flatMap((group) => (group.events || []).map((event) => Number(event.id))));
  const rows = groups.map((group) => {
    const groupServices = group.events || [];
    const dueDate = group.dueDate || group.issueDate || null;
    return {
      ...row,
      rowId: `client:${row.id}:group:${group.key}`,
      billingPeriodLabel: group.label || row.billingPeriodLabel || 'Período de faturação',
      invoices: [],
      billingGroups: [group],
      nonInvoicedServices: groupServices,
      actionableInvoice: null,
      actionableService: firstActionableService(groupServices),
      invoicesCount: 0,
      invoiceDebt: 0,
      pendingBilling: num(group.total),
      totalOpen: num(group.total),
      nextDueDate: dueDate,
      overdueDays: Math.max(0, overdueDaysFromDate(dueDate)),
    };
  });

  const standaloneServices = services.filter((service) => !groupedEventIds.has(Number(service.id)));
  const standaloneOpen = standaloneServices
    .filter(isOpenService)
    .reduce((sum, service) => sum + num(service.financial?.receivable), 0);
  const invoiceDebt = num(row.invoiceDebt);

  if (invoices.length || standaloneServices.length || invoiceDebt || standaloneOpen) {
    rows.push({
      ...row,
      rowId: `client:${row.id}:other`,
      billingPeriodLabel: 'Outros valores',
      billingGroups: [],
      nonInvoicedServices: standaloneServices,
      pendingBilling: 0,
      totalOpen: invoiceDebt + standaloneOpen,
      actionableService: firstActionableService(standaloneServices),
    });
  }

  return rows;
}
