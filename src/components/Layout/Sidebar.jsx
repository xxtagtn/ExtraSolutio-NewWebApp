import { BarChart3, BriefcaseBusiness, CalendarCheck2, CalendarDays, CalendarRange, FileText, LayoutDashboard, ListChecks, MessageSquareText, ShieldCheck, Users, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from '../../utils/navigation.js';

const links = [
  { to: DEFAULT_AUTHENTICATED_PATH, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendário', icon: CalendarRange },
  { to: '/collaborators', label: 'Colaboradores', icon: Users },
  { to: '/clients', label: 'Clientes', icon: BriefcaseBusiness },
  { to: '/budgets', label: 'Orçamentos', icon: FileText },
  { to: '/services', label: 'Eventos/Serviços', icon: CalendarDays },
  { to: '/communication', label: 'Comunicação', icon: MessageSquareText },
  { to: '/time-validation', label: 'Validação de Horas', icon: CalendarCheck2 },
  { to: '/finance', label: 'Financeiro', icon: BarChart3 },
  { to: BALANCETE_PATH, label: 'Balancete', icon: ListChecks },
];

export default function Sidebar({ mobileOpen = false, onClose }) {
  const { user } = useAuth();
  const visibleLinks = user?.role === 'admin'
    ? [...links, { to: '/admin', label: 'Administração', icon: ShieldCheck }]
    : links;

  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
      <div className="brand">
        <span className="brand__mark brand__mark--logo">
          <img src="/logo.png" alt="ExtraSolutio" />
        </span>
        <div>
          <strong>ExtraSolutio</strong>
          <small>Staff & Eventos</small>
        </div>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <X size={18} />
        </button>
      </div>
      <nav>
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end onClick={onClose}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
