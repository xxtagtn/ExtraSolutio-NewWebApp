import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Search,
  ShieldAlert,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import { useApi } from '../hooks/useApi.js';
import { date } from '../utils/formatters.js';
import { buildPendingActions, groupPendingActions } from '../utils/pendingActions.js';

const priorityLabels = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const categoryIcons = {
  'Eventos/Serviços': CalendarClock,
  'Validação de Horas': ClipboardList,
  Staff: UsersRound,
  Clientes: WalletCards,
  Orçamentos: FileText,
  Documentos: ShieldAlert,
};

function formatActionDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return date.format(parsed);
}

function daysUntil(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.round((target.getTime() - todayStart.getTime()) / 86400000);
}

export default function PendingActions() {
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: collaborators, loading: loadingCollaborators, error: collaboratorsError } = useApi('/collaborators', []);
  const { data: budgets, loading: loadingBudgets, error: budgetsError } = useApi('/budgets', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');

  const actions = useMemo(
    () => buildPendingActions({ services, collaborators, budgets, invoices }),
    [services, collaborators, budgets, invoices],
  );

  const categories = useMemo(
    () => [...new Set(actions.map((action) => action.category))].sort((a, b) => a.localeCompare(b, 'pt')),
    [actions],
  );

  const visibleActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return actions.filter((action) => {
      const matchesCategory = category === 'all' || action.category === category;
      const matchesPriority = priority === 'all' || action.priority === priority;
      const haystack = [
        action.category,
        action.title,
        action.description,
        ...(action.meta || []),
      ].join(' ').toLowerCase();
      return matchesCategory && matchesPriority && (!q || haystack.includes(q));
    });
  }, [actions, category, priority, search]);

  const groupedActions = useMemo(() => groupPendingActions(visibleActions), [visibleActions]);

  const areaCounts = useMemo(
    () => categories.map((item) => ({
      category: item,
      count: actions.filter((action) => action.category === item).length,
    })),
    [actions, categories],
  );

  const stats = useMemo(() => {
    const next48h = actions.filter((action) => {
      const diff = daysUntil(action.dueDate);
      return diff !== null && diff >= 0 && diff <= 2;
    }).length;
    const critical = actions.filter((action) => ['critical', 'high'].includes(action.priority)).length;
    const today = actions.filter((action) => daysUntil(action.dueDate) === 0).length;
    const financial = actions.filter((action) => ['Clientes', 'Staff'].includes(action.category)).length;
    const operational = actions.filter((action) => ['Eventos/Serviços', 'Validação de Horas'].includes(action.category)).length;
    return { total: actions.length, critical, today, next48h, financial, operational };
  }, [actions]);

  const loading = loadingServices || loadingCollaborators || loadingBudgets || loadingInvoices;
  const error = servicesError || collaboratorsError || budgetsError || invoicesError;

  return (
    <div className="page pending-page">
      <div className="pending-header">
        <div>
          <span className="eyebrow">Operação</span>
          <h1>Dashboard</h1>
        </div>
        <div className="pending-filterbar">
          <label>
            <Search size={15} />
            <input
              className="form-control"
              value={search}
              placeholder="Procurar ação, cliente ou evento"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select className="form-control" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Todas as áreas</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="form-control" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="all">Todas as prioridades</option>
            {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {error ? <p className="notice">{error}</p> : null}

      <div className="pending-kpis">
        <article className={stats.critical ? 'pending-kpi pending-kpi--danger' : 'pending-kpi'}>
          <AlertTriangle size={17} />
          <span>Urgentes</span>
          <strong>{stats.critical}</strong>
        </article>
        <article className="pending-kpi">
          <CalendarClock size={17} />
          <span>Hoje</span>
          <strong>{stats.today}</strong>
        </article>
        <article className={stats.next48h ? 'pending-kpi pending-kpi--warning' : 'pending-kpi'}>
          <CalendarClock size={17} />
          <span>Próximas 48h</span>
          <strong>{stats.next48h}</strong>
        </article>
        <article className="pending-kpi">
          <WalletCards size={17} />
          <span>Financeiro</span>
          <strong>{stats.financial}</strong>
        </article>
        <article className="pending-kpi">
          <ClipboardList size={17} />
          <span>Operação</span>
          <strong>{stats.operational}</strong>
        </article>
      </div>

      <div className="pending-board">
        <main className="pending-board-main">
          {loading ? <p className="muted">A carregar...</p> : null}
          {!loading && visibleActions.length === 0 ? (
            <div className="pending-empty">
              <CheckCircle2 size={22} />
              <strong>Sem ações pendentes</strong>
              <span>Os filtros atuais não têm resultados.</span>
            </div>
          ) : null}

          {groupedActions.map((group) => (
            <section key={group.id} className={`pending-section pending-section--${group.id}`}>
              <header>
                <div>
                  <span>{group.actions.length}</span>
                  <h2>{group.label}</h2>
                </div>
              </header>
              <div className="pending-row-list">
                {group.actions.map((action) => {
                  const Icon = categoryIcons[action.category] || ClipboardList;
                  return (
                    <Link key={action.id} className={`pending-row pending-row--${action.tone}`} to={action.to}>
                      <span className="pending-row-icon">
                        <Icon size={16} />
                      </span>
                      <div className="pending-row-body">
                        <div className="pending-row-heading">
                          <strong>{action.title}</strong>
                          <Badge tone={action.tone}>{priorityLabels[action.priority] || action.priority}</Badge>
                        </div>
                        <p>{action.description}</p>
                        {action.meta?.length ? (
                          <div className="pending-row-meta">
                            {action.meta.map((item) => <span key={item}>{item}</span>)}
                          </div>
                        ) : null}
                      </div>
                      <div className="pending-row-date">
                        <span>{action.category}</span>
                        <strong>{formatActionDate(action.dueDate)}</strong>
                      </div>
                      <span className="pending-row-open">Abrir</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        <aside className="pending-sidebar-panel">
          <div className="pending-sidebar-head">
            <span>Áreas</span>
            <strong>{stats.total}</strong>
          </div>
          <button
            type="button"
            className={`pending-area-chip ${category === 'all' ? 'pending-area-chip--active' : ''}`}
            onClick={() => setCategory('all')}
          >
            <span>Todas</span>
            <strong>{stats.total}</strong>
          </button>
          {areaCounts.map((item) => (
            <button
              key={item.category}
              type="button"
              className={`pending-area-chip ${category === item.category ? 'pending-area-chip--active' : ''}`}
              onClick={() => setCategory(item.category)}
            >
              <span>{item.category}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
