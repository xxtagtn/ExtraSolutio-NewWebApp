import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../utils/api.js';
import { birthdayNotification } from '../../utils/birthdays.js';
import { isFinanceReadyEvent } from '../../utils/financeReadiness.js';
import { prepaymentRemainingReminderDate } from '../../utils/prepaymentPolicy.js';
import { staffPaymentTiming } from '../../utils/staffPayment.js';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import BackToTop from '../UI/BackToTop.jsx';

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function safeArrayJson(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function startOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function Layout() {
  const [dismissed, setDismissed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('extrasolutio.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [ignoredNotifications, setIgnoredNotifications] = useState([]);
  const [notificationReferenceDate, setNotificationReferenceDate] = useState(() => new Date());
  const location = useLocation();
  const { data: services } = useApi('/services', []);
  const { data: budgets } = useApi('/budgets', []);
  const { data: invoices } = useApi('/invoices', []);
  const { data: collaborators } = useApi('/collaborators?light=1', []);
  const { data: ignoredFromDb } = useApi('/notifications/ignored', []);

  const reminders = useMemo(
    () => (services || []).filter((service) => (
      service.billingStatus === 'partial70'
      && isToday(prepaymentRemainingReminderDate(service))
    )),
    [services],
  );
  const showReminder = reminders.length > 0 && !dismissed;

  const notifications = useMemo(() => {
    const now = notificationReferenceDate;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const items = [];

    for (const budget of budgets || []) {
      let history = [];
      try {
        history = Array.isArray(budget.followUpHistory)
          ? budget.followUpHistory
          : JSON.parse(budget.followUpHistory || '[]');
      } catch {
        history = [];
      }
      for (const item of history) {
        if (!item?.reminderDate) continue;
        const reminderDate = new Date(item.reminderDate);
        if (Number.isNaN(reminderDate.getTime())) continue;
        const dueDate = new Date(reminderDate.getFullYear(), reminderDate.getMonth(), reminderDate.getDate());
        if (dueDate <= todayStart) {
          items.push({
            id: `followup-${budget.id}-${item.reminderDate}-${item.text || ''}`,
            kind: 'followup',
            title: budget.clientName || budget.clientCompany || budget.clientEmail || `Orçamento #${budget.id}`,
            subtitle: item.text || 'Follow-up pendente',
            dueDate,
          });
        }
      }
    }

    for (const service of services || []) {
      if (!isFinanceReadyEvent(service)) continue;
      const assignments = Array.isArray(service.assignments) ? service.assignments : [];
      const paymentRows = assignments.filter((assignment) => {
        const status = String(assignment.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'missed_justified' || status === 'missed_unjustified') return false;
        if (String(assignment.paymentStatus || 'unpaid') === 'paid') return false;
        const timing = staffPaymentTiming({ ...assignment, event: service }, now);
        return timing.status === 'open';
      });
      if (paymentRows.length > 0) {
        const dueDates = paymentRows
          .map((assignment) => staffPaymentTiming({ ...assignment, event: service }, now).start)
          .filter((value) => value && !Number.isNaN(value.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
        items.push({
          id: `staff-unpaid-${service.id}`,
          kind: 'staff_payment',
          title: service.name || `Evento #${service.id}`,
          subtitle: `${paymentRows.length} colaborador(es) por pagar`,
          dueDate: dueDates[0] || todayStart,
        });
      }
    }

    for (const invoice of invoices || []) {
      const status = String(invoice.status || '').toLowerCase();
      if (status === 'paid' || status === 'cancelled') continue;
      if (!invoice.dueDate) continue;
      const dueDate = new Date(invoice.dueDate);
      if (Number.isNaN(dueDate.getTime())) continue;
      const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
      if (dueStart < todayStart) {
        const days = Math.floor((todayStart.getTime() - dueStart.getTime()) / 86_400_000);
        items.push({
          id: `invoice-overdue-${invoice.id}`,
          kind: 'invoice_overdue',
          title: invoice.number || `Fatura #${invoice.id}`,
          subtitle: `Vencida há ${days} dia(s)`,
          dueDate: dueStart,
        });
      }
    }

    for (const collaborator of collaborators || []) {
      if (!collaborator?.documentType || !collaborator?.documentExpiry) continue;
      const expiryDate = new Date(collaborator.documentExpiry);
      if (Number.isNaN(expiryDate.getTime())) continue;
      const expiryStart = startOfDay(expiryDate);
      const days = Math.floor((expiryStart.getTime() - todayStart.getTime()) / 86_400_000);
      if (days > 90) continue;
      const label = days < 0
        ? `Documento expirado há ${Math.abs(days)} dia(s)`
        : days <= 30
          ? `Documento expira em ${days} dia(s) [30]`
          : days <= 60
            ? `Documento expira em ${days} dia(s) [60]`
            : `Documento expira em ${days} dia(s) [90]`;
      items.push({
        id: `doc-expiry-${collaborator.id}-${String(collaborator.documentExpiry).slice(0, 10)}`,
        kind: 'document_expiry',
        title: collaborator.shortName || collaborator.name || `Colaborador #${collaborator.id}`,
        subtitle: label,
        dueDate: expiryStart,
      });
    }

    const nowPlus48h = new Date(now.getTime() + (48 * 60 * 60 * 1000));
    for (const service of services || []) {
      if (!service?.date) continue;
      const startTime = service.startTime || '00:00';
      const startDt = new Date(`${String(service.date).slice(0, 10)}T${startTime}:00`);
      if (Number.isNaN(startDt.getTime())) continue;
      if (startDt < now || startDt > nowPlus48h) continue;
      const requiredRoles = safeArrayJson(service.requiredRoles);
      const requested = service.isContinuous
        ? (service.assignments || []).filter((item) => item.role && item.collaboratorId && item.assignmentDate).length
        : requiredRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      const confirmed = (service.assignments || []).filter((item) => String(item.status || '').toLowerCase() === 'confirmed').length;
      if (requested > 0 && confirmed >= requested) continue;
      items.push({
        id: `team-incomplete-${service.id}`,
        kind: 'team_incomplete',
        title: service.name || `Evento #${service.id}`,
        subtitle: `Equipa incompleta (${confirmed}/${requested || 0})`,
        dueDate: startOfDay(startDt),
      });
    }

    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
    for (const service of services || []) {
      if (!service?.date) continue;
      const endBase = service.isContinuous && service.endDate ? service.endDate : service.date;
      const endDay = startOfDay(new Date(endBase));
      if (Number.isNaN(endDay.getTime())) continue;
      if (endDay.getTime() !== yesterdayStart.getTime()) continue;
      const status = String(service.status || '').toLowerCase();
      const pendingValidation = (service.assignments || []).some((item) => String(item.validationStatus || '').toLowerCase() !== 'validated');
      if (!['to_validate_staff', 'to_validate_client'].includes(status) && !pendingValidation) continue;
      items.push({
        id: `validate-nextday-${service.id}-${String(endBase).slice(0, 10)}`,
        kind: 'time_validation',
        title: service.name || `Evento #${service.id}`,
        subtitle: 'Validação de horários pendente (dia seguinte)',
        dueDate: todayStart,
      });
    }

    const todayBirthdayNotification = birthdayNotification(collaborators, now);
    if (todayBirthdayNotification) items.push(todayBirthdayNotification);

    const ignored = new Set(ignoredNotifications);
    const allItems = items
      .map((item) => ({ ...item, ignored: ignored.has(item.id) }))
      .sort((a, b) => {
        const aTime = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.title || '').localeCompare(String(b.title || ''), 'pt');
      });
    const visibleItems = allItems.filter((item) => !item.ignored);

    return {
      allItems,
      items: visibleItems,
      total: visibleItems.length,
    };
  }, [budgets, invoices, services, collaborators, ignoredNotifications, notificationReferenceDate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setNotificationReferenceDate((current) => (
        current.toDateString() === now.toDateString() ? current : now
      ));
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem('extrasolutio.sidebar.collapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!Array.isArray(ignoredFromDb)) return;
    setIgnoredNotifications(ignoredFromDb.filter(Boolean));
  }, [ignoredFromDb]);

  async function ignoreNotification(id) {
    const key = String(id || '').trim();
    if (!key) return;
    if (ignoredNotifications.includes(key)) return;
    setIgnoredNotifications((prev) => [...prev, key]);
    try {
      await api('/notifications/ignored', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
    } catch {
      setIgnoredNotifications((prev) => prev.filter((item) => item !== key));
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}>
      <Sidebar
        mobileOpen={mobileNavOpen}
        collapsed={sidebarCollapsed && !mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
      />
      <button
        type="button"
        className={`sidebar-backdrop ${mobileNavOpen ? 'sidebar-backdrop--open' : ''}`}
        aria-label="Fechar menu"
        onClick={() => setMobileNavOpen(false)}
      />
      <main>
        <Header
          onToggleMenu={() => setMobileNavOpen((prev) => !prev)}
          notifications={notifications}
          onIgnoreNotification={ignoreNotification}
        />
        <Outlet />
        {showReminder ? (
          <div className="payment-reminder-toast" role="status" aria-live="polite">
            <button className="icon-button payment-reminder-close" type="button" onClick={() => setDismissed(true)}>×</button>
            <strong>Restante da sinalização</strong>
            <ul>
              {reminders.map((service) => <li key={service.id}>{service.name}</li>)}
            </ul>
          </div>
        ) : null}
        <BackToTop raised={showReminder} />
      </main>
    </div>
  );
}
