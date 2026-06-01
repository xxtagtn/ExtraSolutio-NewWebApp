import { BarChart3, BriefcaseBusiness, CalendarCheck2, CalendarDays, CalendarRange, FileText, LayoutDashboard, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendário', icon: CalendarRange },
  { to: '/collaborators', label: 'Colaboradores', icon: Users },
  { to: '/clients', label: 'Clientes', icon: BriefcaseBusiness },
  { to: '/budgets', label: 'Orçamentos', icon: FileText },
  { to: '/services', label: 'Eventos/Serviços', icon: CalendarDays },
  { to: '/time-validation', label: 'Validação de Horas', icon: CalendarCheck2 },
  { to: '/finance', label: 'Financeiro', icon: BarChart3 },
  { to: '/invoices', label: 'Faturação', icon: FileText },
];

export default function Sidebar({ mobileOpen = false, onClose }) {
  const { user } = useAuth();
  const visibleLinks = user?.role === 'admin'
    ? [...links, { to: '/admin', label: 'Administração', icon: ShieldCheck }, { to: '/profile', label: 'Perfil', icon: UserRound }]
    : [...links, { to: '/profile', label: 'Perfil', icon: UserRound }];

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
          <NavLink key={to} to={to} end={to === '/'} onClick={onClose}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
