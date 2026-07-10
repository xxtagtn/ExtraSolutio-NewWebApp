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
