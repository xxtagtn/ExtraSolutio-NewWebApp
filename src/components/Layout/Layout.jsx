import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.js';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export default function Layout() {
  const [dismissed, setDismissed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const { data: services } = useApi('/services', []);
  const reminders = useMemo(
    () => (services || []).filter((service) => service.billingStatus === 'partial70' && isToday(service.remainingPaymentDate)),
    [services],
  );
  const showReminder = reminders.length > 0 && !dismissed;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <button
        type="button"
        className={`sidebar-backdrop ${mobileNavOpen ? 'sidebar-backdrop--open' : ''}`}
        aria-label="Fechar menu"
        onClick={() => setMobileNavOpen(false)}
      />
      <main>
        <Header onToggleMenu={() => setMobileNavOpen((prev) => !prev)} />
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
      </main>
    </div>
  );
}
