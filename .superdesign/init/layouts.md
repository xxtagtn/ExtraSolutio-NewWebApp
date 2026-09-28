# Shared Layouts

### `src/components/Layout/Layout.jsx`

```jsx
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

```

### `src/components/Layout/Header.jsx`

```jsx
import { AlertTriangle, Bell, BellRing, CakeSlice, CalendarClock, ChevronDown, Clock3, FileWarning, LogOut, Menu, Receipt, UserRound, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { visibleProfileMenuItems } from '../../utils/appNavigation.js';
import { date } from '../../utils/formatters.js';
import { userInitials } from '../../utils/userProfile.js';
import EmptyState from '../UI/EmptyState.jsx';

function notificationIcon(kind) {
  if (kind === 'followup') return <Clock3 size={15} />;
  if (kind === 'staff_payment') return <Wallet size={15} />;
  if (kind === 'invoice_overdue') return <Receipt size={15} />;
  if (kind === 'document_expiry') return <FileWarning size={15} />;
  if (kind === 'team_incomplete') return <AlertTriangle size={15} />;
  if (kind === 'time_validation') return <CalendarClock size={15} />;
  if (kind === 'birthday') return <CakeSlice size={15} />;
  return <BellRing size={15} />;
}

const roleLabels = {
  admin: 'Administrador',
  manager: 'Gestão',
  operations: 'Operacional',
  finance: 'Financeiro',
  viewer: 'Consulta',
};

export default function Header({ onToggleMenu, notifications, onIgnoreNotification }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const panelRef = useRef(null);
  const profileRef = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (open && panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
      if (profileOpen && profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    }
    if (open || profileOpen) document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, profileOpen]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const list = showIgnored ? (notifications?.allItems || []) : (notifications?.items || []);
  const profileItems = visibleProfileMenuItems(user);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button type="button" className="menu-toggle" onClick={onToggleMenu} aria-label="Abrir menu">
          <Menu size={18} />
        </button>
        <div>
          <h1>ExtraSolutio</h1>
          <span className="eyebrow">Staff & Eventos</span>
        </div>
      </div>
      <div className="topbar__actions">
        <div className="notification-box" ref={panelRef}>
          <button type="button" className="secondary-button notification-button notification-button--icon" onClick={() => setOpen((prev) => !prev)} aria-label="Notificações">
            <Bell size={17} />
            {notifications?.total ? <span className="notification-count">{notifications.total}</span> : null}
          </button>
          {open ? (
            <div className="notification-panel">
              <div className="notification-panel-head">
                <h4>Notificações</h4>
                <label className="check-inline">
                  <input type="checkbox" checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} />
                  <span>Ver ignoradas</span>
                </label>
              </div>
              {list.length ? list.slice(0, 30).map((item) => (
                <div key={item.id} className="notification-row">
                  <div className={`notification-kind notification-kind--${item.kind || 'default'}`}>
                    {notificationIcon(item.kind)}
                  </div>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                    {item.dueDate ? <small>{date.format(new Date(item.dueDate))}</small> : null}
                  </div>
                  {item.ignored ? (
                    <span className="notification-ignored">Ignorada</span>
                  ) : (
                    <button type="button" className="secondary-button notification-ignore" onClick={() => onIgnoreNotification?.(item.id)}>
                      Ignorar
                    </button>
                  )}
                </div>
              )) : (
                <EmptyState
                  compact
                  icon={Bell}
                  title={showIgnored ? 'Sem notificações registadas' : 'Sem notificações ativas'}
                  description={showIgnored ? 'Não existem notificações ativas ou ignoradas.' : 'Quando existir algo a acompanhar, aparece aqui por ordem cronológica.'}
                />
              )}
            </div>
          ) : null}
        </div>
        <div className="profile-menu-box" ref={profileRef}>
          <button
            type="button"
            className="profile-link"
            onClick={() => setProfileOpen((prev) => !prev)}
            aria-label="Abrir menu do perfil"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
          >
            {user?.photo ? (
              <span className="topbar-profile-avatar"><img src={user.photo} alt={`Foto de ${user.name || 'utilizador'}`} /></span>
            ) : (
              <span className="topbar-profile-avatar topbar-profile-avatar--initials">{userInitials(user?.name || '') || <UserRound size={17} />}</span>
            )}
            <span className="topbar-profile-copy">
              <strong>{user?.name || 'Perfil'}</strong>
              <small>{roleLabels[user?.role] || user?.profile?.name || 'Perfil'}</small>
            </span>
            <ChevronDown className={`topbar-profile-chevron ${profileOpen ? 'topbar-profile-chevron--open' : ''}`} size={15} aria-hidden="true" />
          </button>
          {profileOpen ? (
            <div className="profile-menu" role="menu">
              {profileItems.map((item) => (
                <Link key={item.key} to={item.to} role="menuitem" onClick={() => setProfileOpen(false)}>
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <button className="secondary-button" type="button" onClick={handleLogout}>
          <LogOut size={17} />
          Sair
        </button>
      </div>
    </header>
  );
}

```

### `src/components/Layout/Sidebar.jsx`

```jsx
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { visibleSidebarItems } from '../../utils/appNavigation.js';

const iconsByKey = {
  dashboard: LayoutDashboard,
  calendar: CalendarRange,
  collaborators: Users,
  clients: BriefcaseBusiness,
  budgets: FileText,
  services: CalendarDays,
  timeValidation: CalendarCheck2,
  finance: BarChart3,
  communication: MessageSquareText,
  balancete: ListChecks,
};

export default function Sidebar({
  mobileOpen = false,
  collapsed = false,
  onClose,
  onToggleCollapsed,
}) {
  const { user } = useAuth();
  const visibleLinks = visibleSidebarItems(user);

  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="brand">
        <span className="brand__mark brand__mark--logo">
          <img src="/logo.png" alt="ExtraSolutio" />
        </span>
        <div className="brand__text">
          <strong>ExtraSolutio</strong>
          <small>Staff & Eventos</small>
        </div>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir' : 'Recolher'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <X size={18} />
        </button>
      </div>
      <nav>
        {visibleLinks.map(({ key, to, label }) => {
          const Icon = iconsByKey[key] || LayoutDashboard;
          return (
            <NavLink key={to} to={to} end onClick={onClose} title={collapsed ? label : undefined} aria-label={label}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

```

### `src/main.jsx`

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/UI/ToastProvider.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { registerPwaServiceWorker } from './utils/pwaRegistration.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

registerPwaServiceWorker({ prod: import.meta.env.PROD });

```