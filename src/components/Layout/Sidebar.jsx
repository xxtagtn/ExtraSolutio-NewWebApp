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
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from '../../utils/navigation.js';
import { PERMISSIONS, hasPermission } from '../../utils/accessPermissions.js';

const links = [
  { to: DEFAULT_AUTHENTICATED_PATH, label: 'Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.DASHBOARD_VIEW },
  { to: '/calendar', label: 'Calendário', icon: CalendarRange, permission: PERMISSIONS.CALENDAR_VIEW },
  { to: '/collaborators', label: 'Colaboradores', icon: Users, permission: PERMISSIONS.COLLABORATORS_VIEW },
  { to: '/clients', label: 'Clientes', icon: BriefcaseBusiness, permission: PERMISSIONS.CLIENTS_VIEW },
  { to: '/budgets', label: 'Orçamentos', icon: FileText, permission: PERMISSIONS.BUDGETS_VIEW },
  { to: '/services', label: 'Eventos/Serviços', icon: CalendarDays, permission: PERMISSIONS.SERVICES_VIEW },
  { to: '/time-validation', label: 'Validação de Horas', icon: CalendarCheck2, permission: PERMISSIONS.TIME_VALIDATION_VIEW },
  { to: '/finance', label: 'Financeiro', icon: BarChart3, permission: PERMISSIONS.FINANCE_VIEW },
  { to: '/communication', label: 'Comunicação', icon: MessageSquareText, permission: PERMISSIONS.COMMUNICATION_VIEW },
  { to: BALANCETE_PATH, label: 'Balancete', icon: ListChecks, permission: PERMISSIONS.BALANCETE_VIEW },
];

export default function Sidebar({
  mobileOpen = false,
  collapsed = false,
  onClose,
  onToggleCollapsed,
}) {
  const { user } = useAuth();
  const visibleLinks = [
    ...links.filter((link) => !link.permission || hasPermission(user, link.permission)),
    ...(hasPermission(user, PERMISSIONS.ADMIN_VIEW) ? [{ to: '/admin', label: 'Administração', icon: ShieldCheck }] : []),
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
