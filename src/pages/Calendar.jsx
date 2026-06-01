import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/UI/Card.jsx';
import { useApi } from '../hooks/useApi.js';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
const HIDDEN_STATUS = new Set(['cancelled']);
const MONTH_MARKERS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '🟥', '🟧', '🟨', '🟩'];

function toWeekIndex(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function serviceStatusLabel(status) {
  if (status === 'drafting') return 'A preencher';
  if (status === 'team_complete') return 'Equipa completa';
  if (status === 'pending') return 'Pendente';
  if (status === 'in_progress') return 'Em execução';
  if (status === 'completed') return 'Concluído';
  if (status === 'to_validate_staff') return 'Por validar horários (Staff)';
  if (status === 'to_validate_client') return 'Por validar horários (Cliente)';
  if (status === 'invoiced') return 'Faturado';
  if (status === 'paid') return 'Pago';
  if (status === 'cancelled') return 'Cancelado';
  return status || '-';
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Calendar() {
  const today = useMemo(() => new Date(), []);
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();
  const [cursor, setCursor] = useState(new Date(todayYear, todayMonth, 1));
  const [cursorInitialized, setCursorInitialized] = useState(false);
  const { data: services, loading, error } = useApi('/services', []);
  const { data: budgets } = useApi('/budgets', []);

  const visibleServices = useMemo(
    () => services.filter((service) => !HIDDEN_STATUS.has(service.status) && service.date),
    [services],
  );

  const budgetFollowUps = useMemo(() => {
    const reminders = [];
    for (const budget of budgets || []) {
      const history = parseJsonArray(budget.followUpHistory);
      for (const item of history) {
        if (!item?.reminderDate) continue;
        reminders.push({
          budgetId: budget.id,
          reference: budget.reference,
          clientName: budget.client?.name || budget.companyName || budget.leadName || 'Cliente',
          text: item.text || 'Follow-up',
          reminderDate: item.reminderDate,
          _calendarKey: `budget-followup-${budget.id}-${item.reminderDate}-${item.text || ''}`,
        });
      }
    }
    return reminders;
  }, [budgets]);

  useEffect(() => {
    if (loading || cursorInitialized) return;
    if (!visibleServices.length) {
      setCursorInitialized(true);
      return;
    }
    const nowTs = new Date(todayYear, todayMonth, todayDay).getTime();
    const sorted = [...visibleServices]
      .map((service) => parseDate(service.date))
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());
    const next = sorted.find((d) => d.getTime() >= nowTs) || sorted[0];
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
    setCursorInitialized(true);
  }, [visibleServices, loading, cursorInitialized, todayDay, todayMonth, todayYear]);

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthStartWeekday = toWeekIndex(firstDay.getDay());
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

  const eventsByDay = useMemo(() => {
    const map = new Map();

    for (const service of visibleServices) {
      const date = parseDate(service.date);
      if (!date) continue;
      if (date.getFullYear() !== cursor.getFullYear() || date.getMonth() !== cursor.getMonth()) continue;
      const day = date.getDate();
      const list = map.get(day) || [];
      list.push({ ...service, _reminder: false });
      map.set(day, list);
    }

    for (const service of visibleServices) {
      if (service.billingStatus !== 'partial70' || !service.remainingPaymentDate) continue;
      const date = parseDate(service.remainingPaymentDate);
      if (!date) continue;
      if (date.getFullYear() !== cursor.getFullYear() || date.getMonth() !== cursor.getMonth()) continue;
      const day = date.getDate();
      const list = map.get(day) || [];
      list.push({ ...service, _reminder: true, _calendarKey: `reminder-${service.id}-${day}` });
      map.set(day, list);
    }

    for (const reminder of budgetFollowUps) {
      const date = parseDate(reminder.reminderDate);
      if (!date) continue;
      if (date.getFullYear() !== cursor.getFullYear() || date.getMonth() !== cursor.getMonth()) continue;
      const day = date.getDate();
      const list = map.get(day) || [];
      list.push({ ...reminder, _budgetReminder: true });
      map.set(day, list);
    }

    for (const [day, list] of map.entries()) {
      list.sort((a, b) => {
        if (a._budgetReminder !== b._budgetReminder) return a._budgetReminder ? -1 : 1;
        if (a._reminder !== b._reminder) return a._reminder ? 1 : -1;
        return String(a.startTime || '').localeCompare(String(b.startTime || ''));
      });
      map.set(day, list);
    }

    return map;
  }, [visibleServices, budgetFollowUps, cursor]);

  const cells = [];
  for (let i = 0; i < monthStartWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const yearOptions = useMemo(() => {
    const years = new Set([todayYear, cursor.getFullYear()]);
    for (const service of services) {
      const d = parseDate(service.date);
      if (d) years.add(d.getFullYear());
      const rp = parseDate(service.remainingPaymentDate);
      if (rp) years.add(rp.getFullYear());
    }
    for (const reminder of budgetFollowUps) {
      const d = parseDate(reminder.reminderDate);
      if (d) years.add(d.getFullYear());
    }
    return [...years].sort((a, b) => a - b);
  }, [services, budgetFollowUps, todayYear, cursor]);

  const monthsWithEventsInYear = useMemo(() => {
    const set = new Set();
    for (const service of visibleServices) {
      const d = parseDate(service.date);
      if (d && d.getFullYear() === cursor.getFullYear()) set.add(d.getMonth());
      if (service.billingStatus === 'partial70') {
        const rp = parseDate(service.remainingPaymentDate);
        if (rp && rp.getFullYear() === cursor.getFullYear()) set.add(rp.getMonth());
      }
    }
    for (const reminder of budgetFollowUps) {
      const d = parseDate(reminder.reminderDate);
      if (d && d.getFullYear() === cursor.getFullYear()) set.add(d.getMonth());
    }
    return set;
  }, [visibleServices, budgetFollowUps, cursor]);

  return (
    <div className="page">
      <Card
        title={(
          <span className="calendar-title-wrap">
            <span>Calendario</span>
            <button className="secondary-button" type="button" onClick={() => setCursor(new Date(todayYear, todayMonth, 1))}>
              Atual
            </button>
          </span>
        )}
        action={(
          <div className="calendar-nav">
            <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft size={16} />
            </button>
            <div className="calendar-nav-pickers">
              <select
                className="form-control"
                value={cursor.getMonth()}
                onChange={(event) => setCursor(new Date(cursor.getFullYear(), Number(event.target.value), 1))}
              >
                {MONTHS_PT.map((month, index) => (
                  <option key={month} value={index}>
                    {monthsWithEventsInYear.has(index) ? `${MONTH_MARKERS[index]} ${month}` : month}
                  </option>
                ))}
              </select>
              <select
                className="form-control"
                value={cursor.getFullYear()}
                onChange={(event) => setCursor(new Date(Number(event.target.value), cursor.getMonth(), 1))}
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      >
        {error ? <p className="notice">{error}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}
        <div className="calendar-grid calendar-grid--head">
          {WEEKDAYS_PT.map((day) => <div key={day} className="calendar-weekday">{day}</div>)}
        </div>
        <div className="calendar-grid">
          {cells.map((day, index) => (
            <div
              key={`${day || 'x'}-${index}`}
              className={`calendar-cell ${day ? '' : 'calendar-cell--empty'} ${
                day && cursor.getMonth() === todayMonth && cursor.getFullYear() === todayYear && day === todayDay ? 'calendar-cell--today' : ''
              }`}
            >
              {day ? (
                <>
                  <header>{day}</header>
                  <div className="calendar-events">
                    {(eventsByDay.get(day) || []).map((item) => (
                      <Link
                        key={item._calendarKey || item.id}
                        to={item._budgetReminder ? '/budgets' : `/services?serviceId=${item.id}`}
                        className="calendar-event"
                      >
                        <strong>
                          {item._budgetReminder
                            ? `Follow-up: ${item.reference || 'Orçamento'}`
                            : (item._reminder ? `Restante sinalização: ${item.name}` : item.name)}
                        </strong>
                        <small>
                          {item._budgetReminder
                            ? `${item.clientName} · ${item.text || 'Follow-up'}`
                            : `${item.client?.name || 'Sem cliente'}${item._reminder ? ' · Pagamento restante' : ` · ${serviceStatusLabel(item.status)}`}`}
                        </small>
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
