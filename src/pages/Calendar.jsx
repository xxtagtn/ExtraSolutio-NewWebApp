import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/UI/Card.jsx';
import { useApi } from '../hooks/useApi.js';
import { birthdaysByDayForMonth, birthdaysOnDate } from '../utils/birthdays.js';
import {
  calendarDateKey,
  calendarInitialCursor,
  calendarDateWithMonth,
  calendarWeekDates,
  serviceOccursOnDate,
} from '../utils/calendarDates.js';
import { statusLabel } from '../utils/serviceStatus.js';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
const HIDDEN_STATUS = new Set(['cancelled']);
const MONTH_MARKERS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '🟥', '🟧', '🟨', '🟩'];
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('pt-PT', { weekday: 'long' });
const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });

function toWeekIndex(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

const serviceStatusLabel = statusLabel;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value) {
  const d = parseDate(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function eventRangeEnd(service) {
  return service?.isContinuous && service.endDate ? service.endDate : service?.date;
}

function eachServiceDayInMonth(service, cursor) {
  const start = startOfDay(service.date);
  const end = startOfDay(eventRangeEnd(service));
  if (!start || !end) return [];
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const rangeStart = start > monthStart ? start : monthStart;
  const rangeEnd = end < monthEnd ? end : monthEnd;
  if (rangeEnd < rangeStart) return [];
  const days = [];
  const current = new Date(rangeStart);
  while (current <= rangeEnd) {
    days.push(current.getDate());
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function eventTouchesYear(service, year) {
  const start = startOfDay(service.date);
  const end = startOfDay(eventRangeEnd(service));
  if (!start || !end) return false;
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  return start <= yearEnd && yearStart <= end;
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

function birthdayTooltip(birthdays) {
  return birthdays
    .map((birthday) => `${birthday.name}${Number.isFinite(birthday.age) ? ` — ${birthday.age} anos` : ''}`)
    .join('\n');
}

function CalendarBirthdays({ birthdays, dateKey, expandedKey, onToggle }) {
  if (!birthdays.length) return null;
  const expanded = expandedKey === dateKey;

  return (
    <div className="calendar-birthdays">
      <button
        type="button"
        className="calendar-birthday-trigger"
        aria-expanded={expanded}
        title={birthdayTooltip(birthdays)}
        onClick={() => onToggle(expanded ? null : dateKey)}
      >
        <span aria-hidden="true">🎂</span>
        <span>{birthdays.length === 1 ? birthdays[0].name : `${birthdays.length} aniversários`}</span>
      </button>
      {expanded ? (
        <div className="calendar-birthday-details">
          {birthdays.map((birthday) => (
            <div key={birthday.collaboratorId}>
              <strong>{birthday.name}</strong>
              {Number.isFinite(birthday.age) ? <small>{birthday.age} anos</small> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CalendarEvents({ items, showEmpty = false }) {
  if (!items.length) return showEmpty ? <p className="calendar-empty-day">Sem eventos ou lembretes.</p> : null;

  return (
    <div className="calendar-events">
      {items.map((item) => {
        const target = item._budgetReminder
          ? `/budgets?budgetId=${item.budgetId || item.id}`
          : `/services/${item.id}`;
        return (
          <Link
            key={item._calendarKey || item.id}
            to={target}
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
        );
      })}
    </div>
  );
}

function calendarItemsForDate(date, services, budgetFollowUps) {
  const key = calendarDateKey(date);
  const items = [];

  for (const service of services) {
    if (serviceOccursOnDate(service, date)) {
      items.push({ ...service, _reminder: false, _calendarKey: `service-${service.id}-${key}` });
    }
    if (
      service.billingStatus === 'partial70'
      && calendarDateKey(service.remainingPaymentDate) === key
    ) {
      items.push({ ...service, _reminder: true, _calendarKey: `reminder-${service.id}-${key}` });
    }
  }

  for (const reminder of budgetFollowUps) {
    if (calendarDateKey(reminder.reminderDate) === key) {
      items.push({ ...reminder, _budgetReminder: true });
    }
  }

  return items.sort((a, b) => {
    if (a._budgetReminder !== b._budgetReminder) return a._budgetReminder ? -1 : 1;
    if (a._reminder !== b._reminder) return a._reminder ? 1 : -1;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
}

export default function Calendar() {
  const today = useMemo(() => new Date(), []);
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();
  const [cursor, setCursor] = useState(() => calendarInitialCursor(today));
  const [calendarView, setCalendarView] = useState('month');
  const [expandedBirthdayKey, setExpandedBirthdayKey] = useState(null);
  const { data: services, loading, error } = useApi('/services', []);
  const { data: budgets } = useApi('/budgets', []);
  const { data: collaborators } = useApi('/collaborators?light=1', []);

  const birthdaysByDay = useMemo(
    () => birthdaysByDayForMonth(collaborators, cursor.getFullYear(), cursor.getMonth()),
    [collaborators, cursor],
  );

  useEffect(() => {
    setExpandedBirthdayKey(null);
  }, [calendarView, cursor]);

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

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthStartWeekday = toWeekIndex(firstDay.getDay());
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

  const eventsByDay = useMemo(() => {
    const map = new Map();

    for (const service of visibleServices) {
      for (const day of eachServiceDayInMonth(service, cursor)) {
      const list = map.get(day) || [];
      list.push({ ...service, _reminder: false, _calendarKey: `service-${service.id}-${day}` });
      map.set(day, list);
      }
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
      const end = parseDate(eventRangeEnd(service));
      if (end) years.add(end.getFullYear());
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
      if (eventTouchesYear(service, cursor.getFullYear())) {
        const start = startOfDay(service.date);
        const end = startOfDay(eventRangeEnd(service));
        const firstMonth = start.getFullYear() < cursor.getFullYear() ? 0 : start.getMonth();
        const lastMonth = end.getFullYear() > cursor.getFullYear() ? 11 : end.getMonth();
        for (let month = firstMonth; month <= lastMonth; month += 1) set.add(month);
      }
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

  const agendaDates = useMemo(
    () => (calendarView === 'week' ? calendarWeekDates(cursor) : [cursor]),
    [calendarView, cursor],
  );

  function moveCursor(direction) {
    if (calendarView === 'month') {
      const target = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
      setCursor(calendarDateWithMonth(cursor, target.getFullYear(), target.getMonth()));
      return;
    }
    const next = new Date(cursor);
    next.setDate(next.getDate() + (calendarView === 'week' ? 7 : 1) * direction);
    setCursor(next);
  }

  function selectMonth(monthIndex) {
    setCursor(calendarDateWithMonth(cursor, cursor.getFullYear(), monthIndex));
  }

  function selectYear(year) {
    setCursor(calendarDateWithMonth(cursor, year, cursor.getMonth()));
  }

  function isTodayDate(value) {
    return calendarDateKey(value) === calendarDateKey(today);
  }

  return (
    <div className="page">
      <Card
        title={(
          <span className="calendar-title-wrap">
            <span>Calendário</span>
            <button className="secondary-button" type="button" onClick={() => setCursor(new Date(todayYear, todayMonth, todayDay))}>
              Atual
            </button>
            <span className="calendar-view-switch" role="tablist" aria-label="Vista do calendário">
              {[
                ['month', 'Mês'],
                ['week', 'Semana'],
                ['day', 'Dia'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={calendarView === value}
                  className={calendarView === value ? 'is-active' : ''}
                  key={value}
                  onClick={() => setCalendarView(value)}
                >
                  {label}
                </button>
              ))}
            </span>
          </span>
        )}
        action={(
          <div className="calendar-nav">
            <button className="icon-button" type="button" aria-label="Período anterior" onClick={() => moveCursor(-1)}>
              <ChevronLeft size={16} />
            </button>
            <div className="calendar-nav-pickers">
              <select
                className="form-control"
                value={cursor.getMonth()}
                onChange={(event) => selectMonth(Number(event.target.value))}
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
                onChange={(event) => selectYear(Number(event.target.value))}
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button className="icon-button" type="button" aria-label="Período seguinte" onClick={() => moveCursor(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      >
        {error ? <p className="notice">{error}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}
        {calendarView === 'month' ? (
          <>
            <div className="calendar-grid calendar-grid--head">
              {WEEKDAYS_PT.map((day) => <div key={day} className="calendar-weekday">{day}</div>)}
            </div>
            <div className="calendar-grid">
              {cells.map((day, index) => {
                const cellDate = day ? new Date(cursor.getFullYear(), cursor.getMonth(), day) : null;
                const cellDateKey = calendarDateKey(cellDate);
                return (
                  <div
                    key={`${day || 'x'}-${index}`}
                    className={`calendar-cell ${day ? '' : 'calendar-cell--empty'} ${cellDate && isTodayDate(cellDate) ? 'calendar-cell--today' : ''}`}
                  >
                    {day ? (
                      <>
                        <header>{day}</header>
                        <CalendarBirthdays
                          birthdays={birthdaysByDay.get(day) || []}
                          dateKey={cellDateKey}
                          expandedKey={expandedBirthdayKey}
                          onToggle={setExpandedBirthdayKey}
                        />
                        <CalendarEvents items={eventsByDay.get(day) || []} />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className={`calendar-agenda calendar-agenda--${calendarView}`}>
            {agendaDates.map((agendaDate) => {
              const dateKey = calendarDateKey(agendaDate);
              return (
                <article
                  className={`calendar-agenda-day ${isTodayDate(agendaDate) ? 'calendar-agenda-day--today' : ''}`}
                  key={dateKey}
                >
                  <header>
                    <strong>{WEEKDAY_FORMAT.format(agendaDate)}</strong>
                    <span>{DAY_MONTH_FORMAT.format(agendaDate)}</span>
                  </header>
                  <CalendarBirthdays
                    birthdays={birthdaysOnDate(collaborators, agendaDate)}
                    dateKey={dateKey}
                    expandedKey={expandedBirthdayKey}
                    onToggle={setExpandedBirthdayKey}
                  />
                  <CalendarEvents
                    items={calendarItemsForDate(agendaDate, visibleServices, budgetFollowUps)}
                    showEmpty
                  />
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
