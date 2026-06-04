import { AlertTriangle, Bell, BellRing, CalendarClock, Clock3, FileWarning, LogOut, Menu, Receipt, UserRound, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { date } from '../../utils/formatters.js';

function notificationIcon(kind) {
  if (kind === 'followup') return <Clock3 size={15} />;
  if (kind === 'staff_payment') return <Wallet size={15} />;
  if (kind === 'invoice_overdue') return <Receipt size={15} />;
  if (kind === 'document_expiry') return <FileWarning size={15} />;
  if (kind === 'team_incomplete') return <AlertTriangle size={15} />;
  if (kind === 'time_validation') return <CalendarClock size={15} />;
  return <BellRing size={15} />;
}

export default function Header({ onToggleMenu, notifications, onIgnoreNotification }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(event.target)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const list = showIgnored ? (notifications?.allItems || []) : (notifications?.items || []);

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
              )) : <p className="muted">Sem notificações para mostrar.</p>}
            </div>
          ) : null}
        </div>
        <Link className="profile-link" to="/profile">
          <UserRound size={17} />
          {user?.name || 'Perfil'}
        </Link>
        <button className="secondary-button" type="button" onClick={handleLogout}>
          <LogOut size={17} />
          Sair
        </button>
      </div>
    </header>
  );
}
