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
