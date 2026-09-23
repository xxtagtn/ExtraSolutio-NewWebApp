import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../utils/api.js';
import { buildLayoutNotifications, layoutPaymentReminders } from '../../utils/layoutNotifications.js';
import { useCommunicationData } from '../../hooks/useCommunicationData.js';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import BackToTop from '../UI/BackToTop.jsx';

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
  const communicationPage = location.pathname.replace(/\/$/, '') === '/communication';
  const { data: remoteOverview } = useCommunicationData(communicationPage ? `/notifications/overview?day=${notificationReferenceDate.toDateString()}` : null);
  const { data: services } = useApi('/services', [], { enabled: !communicationPage });
  const { data: budgets } = useApi('/budgets', [], { enabled: !communicationPage });
  const { data: invoices } = useApi('/invoices', [], { enabled: !communicationPage });
  const { data: collaborators } = useApi('/collaborators?light=1', [], { enabled: !communicationPage });
  const { data: ignoredFromDb } = useApi('/notifications/ignored', []);

  const reminders = useMemo(() => communicationPage ? (remoteOverview?.reminders || []) : layoutPaymentReminders(services), [communicationPage, remoteOverview, services]);
  const showReminder = reminders.length > 0 && !dismissed;

  const notifications = useMemo(() => {
    const result = remoteOverview?.notifications;
    if (communicationPage && result) {
      const allItems = result.allItems.map((item) => ({ ...item, ignored: ignoredNotifications.includes(item.id) }));
      const items = allItems.filter((item) => !item.ignored);
      return { allItems, items, total: items.length };
    }
    return buildLayoutNotifications({ budgets, invoices, services, collaborators, ignoredNotifications, now: notificationReferenceDate });
  }, [communicationPage, remoteOverview, budgets, invoices, services, collaborators, ignoredNotifications, notificationReferenceDate]);

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
