import { BarChart3, BriefcaseBusiness, CalendarCheck2, CalendarDays, CalendarRange, FileText, LayoutDashboard, ListChecks, MessageSquareText, PanelLeftClose, PanelLeftOpen, ShieldCheck, Users, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from '../../utils/navigation.js';
import { canAccessRole, ROLE_GROUPS, ROLES } from '../../utils/roles.js';

const links = [
  { to: DEFAULT_AUTHENTICATED_PATH, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendário', icon: CalendarRange },
  { to: '/collaborators', label: 'Colaboradores', icon: Users },
  { to: '/clients', label: 'Clientes', icon: BriefcaseBusiness, roles: ROLE_GROUPS.finance },
  { to: '/budgets', label: 'Orçamentos', icon: FileText, roles: ROLE_GROUPS.commercial },
  { to: '/services', label: 'Eventos/Serviços', icon: CalendarDays, roles: ROLE_GROUPS.operations },
  { to: '/time-validation', label: 'Validação de Horas', icon: CalendarCheck2, roles: ROLE_GROUPS.operations },
  { to: '/finance', label: 'Financeiro', icon: BarChart3, roles: ROLE_GROUPS.finance },
  { to: '/communication', label: 'Comunicação', icon: MessageSquareText, roles: ROLE_GROUPS.operations },
  { to: BALANCETE_PATH, label: 'Balancete', icon: ListChecks, roles: ROLE_GROUPS.finance },
];

export default function Sidebar({
  mobileOpen = false,
  collapsed = false,
  onClose,
  onToggleCollapsed,
}) {
  const { user } = useAuth();
  const visibleLinks = [
    ...links.filter((link) => !link.roles || canAccessRole(user, link.roles)),
    ...(canAccessRole(user, [ROLES.ADMIN]) ? [{ to: '/admin', label: 'Administração', icon: ShieldCheck }] : []),
  ];

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
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end onClick={onClose} title={collapsed ? label : undefined} aria-label={label}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
