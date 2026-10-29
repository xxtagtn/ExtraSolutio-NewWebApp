import { AlertTriangle, Bell, BellRing, CakeSlice, CalendarClock, ChevronDown, Clock3, FileWarning, LogOut, Menu, Palette, Receipt, UserRound, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { visibleProfileMenuItems } from '../../utils/appNavigation.js';
import { date } from '../../utils/formatters.js';
import { userInitials } from '../../utils/userProfile.js';
import EmptyState from '../UI/EmptyState.jsx';
import ThemePicker, { SeasonalMotif } from '../Appearance/ThemePicker.jsx';
import { useSeasonalTheme } from '../../hooks/useSeasonalTheme.jsx';
import { seasonalThemeLabel } from '../../utils/seasonalTheme.js';

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
  const { preference, theme } = useSeasonalTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const panelRef = useRef(null);
  const profileRef = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (open && panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
      if (profileOpen && profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setProfileOpen(false);
      setAppearanceOpen(false);
      if (profileOpen) profileRef.current?.querySelector('.profile-link')?.focus();
    }
    if (open || profileOpen) document.addEventListener('mousedown', onPointerDown);
    if (open || profileOpen) document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, profileOpen]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const list = showIgnored ? (notifications?.allItems || []) : (notifications?.items || []);
  const profileItems = visibleProfileMenuItems(user);

  return (
    <header className="topbar">
      {theme !== 'original' && (
        <span className="seasonal-header-decoration" aria-hidden="true">
          <SeasonalMotif theme={theme} className="seasonal-corner" />
        </span>
      )}
      <div className="topbar__left">
        <button type="button" className="menu-toggle" onClick={onToggleMenu} aria-label="Abrir menu">
          <Menu size={18} />
        </button>
        <div>
          <div className="topbar-brand-title">
            <h1>ExtraSolutio</h1>
            {theme !== 'original' && <SeasonalMotif theme={theme} />}
          </div>
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
            onClick={() => { setProfileOpen((prev) => !prev); setAppearanceOpen(false); }}
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
              <button type="button" role="menuitem" className="appearance-menu-toggle" aria-expanded={appearanceOpen}
                onClick={() => setAppearanceOpen((prev) => !prev)}>
                <Palette size={17} /><span>Aparência</span><small>{seasonalThemeLabel(preference)}</small><ChevronDown size={14} />
              </button>
              {appearanceOpen && <ThemePicker compact />}
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
