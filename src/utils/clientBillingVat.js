import { clientBillingPeriodForDay } from '../../shared/clientBillingCalendar.js';
import { calculateVatAmount, moneyCents, sumMoney } from '../../shared/money.js';
import { paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { normalizeExternalCosts } from './externalCosts.js';
import { eventStaffVatRate } from './eventSalesTax.js';

function fiscalBases(event) {
  const fiscal = paymentFinancialSnapshot(event);
  if (!fiscal || (fiscal.total !== 0 && !fiscal.components.length)) return null;
  const partners = new Map(normalizeExternalCosts(event.externalCosts).map((cost) => [`partner:${cost.id}`, cost]));
  const bases = [];
  for (const component of fiscal.components) {
    if (!moneyCents(component.base)) continue;
    const partner = partners.get(component.key);
    if (partner?.vatType === 'catering') {
      bases.push({ base: partner.vat13Base, rate: 13 }, { base: partner.vat23Base, rate: 23 });
    } else {
      const rate = Number(component.rate);
      if (component.rate === '' || !Number.isFinite(rate) || rate < 0) return null;
      bases.push({ base: component.base, rate });
    }
  }
  if (moneyCents(sumMoney(...bases.map((part) => part.base))) !== moneyCents(fiscal.base)) return null;
  return { fiscal, bases };
}

function periodBases(event, part) {
  if (part.total == null || part.tax == null) return null;
  const base = sumMoney(part.total, -part.tax);
  if (event.clientFinance.periods.length > 1 && part.staffBase != null && part.staffTax != null
    && moneyCents(base) === moneyCents(part.staffBase) && moneyCents(part.tax) === moneyCents(part.staffTax)) {
    return [{ base, rate: eventStaffVatRate(event) }];
  }
  const snapshot = fiscalBases(event);
  if (!snapshot) return null;
  if (event.clientFinance.periods.length === 1) {
    return moneyCents(snapshot.fiscal.total) === moneyCents(part.total) && moneyCents(snapshot.fiscal.tax) === moneyCents(part.tax)
      ? snapshot.bases : null;
  }
  // A saved global amount can only be assigned a rate when all its fiscal components share that rate.
  const rates = new Set(snapshot.bases.filter((item) => moneyCents(item.base)).map((item) => item.rate));
  return rates.size === 1 ? [{ base, rate: [...rates][0] }] : null;
}

export function pendingBillingVatGroups(events = []) {
  const groups = new Map();
  for (const event of events) {
    const client = event.client || {}, part = event.billingPeriod;
    if (!['monthly', 'biweekly'].includes(client.billingMethod) || !(event.clientId || client.id)
      || event.clientFinance?.billingStatus !== 'unbilled'
      || (event.invoices || []).some((invoice) => !['cancelled', 'void'].includes(invoice.status)) || !part?.days?.length) continue;
    const calendar = clientBillingPeriodForDay(part.days[0], client);
    if (!calendar) continue;
    const key = `${event.clientId || client.id}:${calendar.key}`;
    const group = groups.get(key) || { key, ...calendar, base: 0, recordedTotal: 0, rates: new Map(), eventIds: new Set(), valid: true };
    group.eventIds.add(event.id);
    const bases = periodBases(event, part);
    if (!bases || part.days.some((day) => clientBillingPeriodForDay(day, client)?.key !== calendar.key)) group.valid = false;
    else {
      group.base = sumMoney(group.base, part.total, -part.tax);
      group.recordedTotal = sumMoney(group.recordedTotal, part.total);
      for (const item of bases) group.rates.set(item.rate, sumMoney(group.rates.get(item.rate) || 0, item.base));
    }
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.valid).map((group) => {
    const rates = [...group.rates].sort(([left], [right]) => left - right)
      .map(([rate, base]) => ({ rate, base, tax: calculateVatAmount(base, rate) }));
    const tax = sumMoney(...rates.map((part) => part.tax));
    const total = sumMoney(group.base, tax);
    return { key: group.key, method: group.method, start: group.start, end: group.end, base: group.base, tax, total,
      recordedTotal: group.recordedTotal, rounding: sumMoney(total, -group.recordedTotal), rates, eventIds: [...group.eventIds] };
  });
}
