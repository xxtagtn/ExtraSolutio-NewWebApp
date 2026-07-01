const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const finalizedStatuses = new Set(['finalized', 'completed', 'invoiced', 'paid']);

function numberValue(value) {
  const parsed = Number(String(value ?? 0).replace(/\s/g, '').replace('€', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (finalizedStatuses.has(status)) return 'finalized';
  return status || 'drafting';
}

function eventDate(event) {
  return validDate(event?.date || event?.startDate || event?.createdAt);
}

function eventClientId(event) {
  return String(event?.clientId || event?.client?.id || '');
}

function eventClientName(event) {
  return event?.client?.name || event?.clientName || 'Cliente por associar';
}

function eventRevenue(event) {
  return numberValue(
    event?.financial?.revenue
      ?? event?.calculatedTotalRevenue
      ?? event?.totalRevenue
      ?? event?.expectedRevenue
      ?? 0,
  );
}

function eventStaffCost(event) {
  return numberValue(
    event?.financial?.staffCost
      ?? event?.financial?.staff
      ?? event?.totalCost
      ?? event?.staffCost
      ?? 0,
  );
}

function eventReceivable(event, revenue) {
  if (event?.financial?.receivable !== undefined && event?.financial?.receivable !== null) {
    return Math.max(0, numberValue(event.financial.receivable));
  }
  if (String(event?.billingStatus || '').toLowerCase() === 'paid' || String(event?.paymentStatus || '').toLowerCase() === 'paid') {
    return 0;
  }
  return Math.max(0, revenue - numberValue(event?.paidAmount || event?.prepaymentPaidAmount || event?.signalAmount || 0));
}

function inYear(date, year) {
  return !year || date.getFullYear() === Number(year);
}

function inMonth(date, month) {
  return !month || date.getMonth() + 1 === Number(month);
}

function matchesClient(event, clientId) {
  return !clientId || clientId === 'all' || eventClientId(event) === String(clientId);
}

function matchesStatus(event, status) {
  return !status || status === 'all' || normalizedStatus(event.status) === status;
}

function rowFromEvent(event) {
  const date = eventDate(event);
  const revenue = eventRevenue(event);
  const staff = eventStaffCost(event);
  const margin = revenue - staff;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
  return {
    id: event.id,
    event,
    eventName: event.name || 'Evento/Serviço',
    clientId: eventClientId(event),
    clientName: eventClientName(event),
    date,
    revenue,
    staff,
    margin,
    marginPct,
    receivable: eventReceivable(event, revenue),
    status: normalizedStatus(event.status),
    rawStatus: event.status || '',
  };
}

function periodRows(services, period) {
  return (services || [])
    .filter((event) => normalizedStatus(event.status) !== 'cancelled')
    .filter((event) => matchesClient(event, period.clientId))
    .filter((event) => matchesStatus(event, period.status))
    .map(rowFromEvent)
    .filter((row) => row.date && inYear(row.date, period.year) && inMonth(row.date, period.month))
    .sort((a, b) => a.date - b.date || String(a.eventName).localeCompare(String(b.eventName), 'pt'));
}

function annualRows(services, period) {
  return (services || [])
    .filter((event) => normalizedStatus(event.status) !== 'cancelled')
    .filter((event) => matchesClient(event, period.clientId))
    .filter((event) => matchesStatus(event, period.status))
    .map(rowFromEvent)
    .filter((row) => row.date && inYear(row.date, period.year));
}

function sum(rows, field) {
  return Number(rows.reduce((total, row) => total + numberValue(row[field]), 0).toFixed(2));
}

function buildMonthlySeries(rows) {
  return monthNames.map((month, index) => {
    const monthRows = rows.filter((row) => row.date.getMonth() === index);
    const receita = sum(monthRows, 'revenue');
    const staff = sum(monthRows, 'staff');
    return {
      month,
      receita,
      staff,
      margem: Number((receita - staff).toFixed(2)),
    };
  });
}

function buildAlerts(rows) {
  const lowMarginRows = rows.filter((row) => row.revenue > 0 && row.marginPct < 20);
  const receivableClients = new Set(rows.filter((row) => row.receivable > 0).map((row) => row.clientId || row.clientName));
  const receivable = sum(rows, 'receivable');
  const staffRows = rows.filter((row) => row.staff > 0);
  return {
    lowMarginEvents: { count: lowMarginRows.length, rows: lowMarginRows },
    clientsOpen: { count: receivableClients.size, value: receivable },
    staffToProcess: { count: staffRows.length, rows: staffRows },
  };
}

export function buildBalanceOverview({ services = [], period = {} } = {}) {
  const currentRows = periodRows(services, period);
  const annual = annualRows(services, period);
  const validatedRevenue = sum(currentRows, 'revenue');
  const staffToPay = sum(currentRows, 'staff');
  const realMargin = Number((validatedRevenue - staffToPay).toFixed(2));

  return {
    eventRows: currentRows,
    monthlySeries: buildMonthlySeries(annual),
    alerts: buildAlerts(currentRows),
    kpis: {
      validatedRevenue,
      staffToPay,
      realMargin,
      receivable: sum(currentRows, 'receivable'),
      finalizedEvents: currentRows.filter((row) => row.status === 'finalized').length,
    },
  };
}
