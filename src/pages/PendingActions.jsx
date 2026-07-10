import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock3,
  Euro,
  FileText,
  Inbox,
  MessageSquareText,
  Search,
  UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import { useApi } from '../hooks/useApi.js';
import { buildDashboardCommandCenter } from '../utils/dashboardCommandCenter.js';
import { date, money } from '../utils/formatters.js';
import { buildPendingActions } from '../utils/pendingActions.js';

const priorityLabels = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const priorityTones = {
  critical: 'danger',
  high: 'warning',
  medium: 'warning',
  low: 'info',
};

const itemIcons = {
  service: CalendarDays,
  action: AlertTriangle,
};

const quickItems = [
  {
    key: 'nextSevenDays',
    label: 'Próximos 7 dias',
    detail: 'Eventos agendados',
    icon: CalendarDays,
  },
  {
    key: 'activeStaff',
    label: 'Staff ativo',
    detail: 'Colaboradores disponíveis',
    icon: UsersRound,
  },
  {
    key: 'openBudgets',
    label: 'Orçamentos em aberto',
    detail: 'Aguardam decisão',
    icon: FileText,
  },
  {
    key: 'pendingFollowUps',
    label: 'Follow-ups pendentes',
    detail: 'Ações por realizar',
    icon: MessageSquareText,
  },
];

function actionDaysUntil(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function relativeDueDate(value) {
  const days = actionDaysUntil(value);
  if (days === null) return '-';
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  if (days > 1) return `${days} dias`;
  return `Há ${Math.abs(days)} dias`;
}

function formatItemDate(item) {
  if (!item?.date) return '';
  const parsed = new Date(item.date);
  if (Number.isNaN(parsed.getTime())) return '';
  return date.format(parsed);
}

function actionButtonLabel(action) {
  if (action.category === 'Staff') return 'Enviar';
  if (action.category === 'Orçamentos') return 'Registar';
  if (action.category === 'Documentos') return 'Ver';
  return 'Abrir';
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'accent' }) {
  return (
    <article className={`command-kpi command-kpi--${tone}`}>
      <div className="command-kpi__icon">
        <Icon size={24} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function TimelinePanel({ title, actionLabel, to, items = [], emptyTitle = 'Sem registos', emptyText }) {
  return (
    <section className="command-panel command-panel--timeline">
      <header>
        <div>
          <CalendarDays size={18} />
          <h2>{title}</h2>
        </div>
        {to ? <Link to={to}>{actionLabel}</Link> : null}
      </header>
      <div className="command-timeline">
        {items.length ? items.map((item) => {
          const Icon = itemIcons[item.type] || AlertTriangle;
          return (
            <Link key={item.id} className="command-timeline-row" to={item.to}>
              <span className={`command-timeline-icon command-timeline-icon--${item.tone || 'neutral'}`}>
                <Icon size={18} />
              </span>
              <div>
                <strong>{item.title}</strong>
                <span>{[formatItemDate(item), item.time].filter(Boolean).join(' · ') || item.subtitle}</span>
              </div>
              {item.badge ? <Badge tone={item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : 'success'}>{item.badge}</Badge> : null}
              <span className="command-timeline-action">{item.actionLabel || 'Abrir'}</span>
              <ChevronRight size={16} className="command-row-chevron" />
            </Link>
          );
        }) : (
          <EmptyState
            compact
            icon={CalendarDays}
            title={emptyTitle}
            description={emptyText}
          />
        )}
      </div>
    </section>
  );
}

export default function PendingActions() {
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: collaborators, loading: loadingCollaborators, error: collaboratorsError } = useApi('/collaborators?light=1', []);
  const { data: budgets, loading: loadingBudgets, error: budgetsError } = useApi('/budgets', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const [showAllActions, setShowAllActions] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');

  const actions = useMemo(
    () => buildPendingActions({ services, collaborators, budgets, invoices }),
    [services, collaborators, budgets, invoices],
  );

  const overview = useMemo(
    () => buildDashboardCommandCenter({ services, collaborators, budgets, actions }),
    [actions, budgets, collaborators, services],
  );

  const loading = loadingServices || loadingCollaborators || loadingBudgets || loadingInvoices;
  const error = servicesError || collaboratorsError || budgetsError || invoicesError;
  const tableActions = useMemo(() => {
    const source = showAllActions ? overview.allPendingActions : overview.pendingActions;
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((action) => [
      action.category,
      action.title,
      action.description,
      action.origin,
      ...(action.details || []).flatMap((item) => [item.label, item.value]),
      ...(action.meta || []),
    ].join(' ').toLowerCase().includes(q));
  }, [overview.allPendingActions, overview.pendingActions, search, showAllActions]);

  return (
    <div className="page command-dashboard-page">
      <div className="command-dashboard-head">
        <div>
          <h1>Dashboard</h1>
          <p>Centro de ações operacionais</p>
        </div>
        <button
          type="button"
          className="icon-button command-dashboard-search"
          aria-label="Procurar"
          onClick={() => setShowSearch((current) => !current)}
        >
          <Search size={19} />
        </button>
      </div>

      {showSearch ? (
        <label className="command-dashboard-filter">
          <Search size={16} />
          <input
            value={search}
            placeholder="Procurar ação, cliente ou evento"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}

      <section className="command-kpi-grid" aria-label="Resumo operacional">
        <KpiCard
          icon={CalendarDays}
          label="Eventos hoje"
          value={overview.kpis.eventsToday.value}
          tone="accent"
        />
        <KpiCard
          icon={UsersRound}
          label="Staff por confirmar"
          value={overview.kpis.staffPending.value}
          tone="warning"
        />
        <KpiCard
          icon={Clock3}
          label="Horários por validar"
          value={overview.kpis.hoursPending.value}
          tone="info"
        />
        <KpiCard
          icon={Euro}
          label="Valor pronto para faturar"
          value={money.format(overview.kpis.readyToInvoice.value)}
          detail="Eventos finalizados"
          tone="success"
        />
      </section>

      <section className="command-main-grid">
        <TimelinePanel
          title="Hoje"
          actionLabel="Ver agenda"
          to="/calendar"
          items={overview.todayItems}
          emptyTitle={loading ? 'A carregar agenda' : 'Dia sem ações urgentes'}
          emptyText={loading ? 'A recolher eventos e tarefas do dia.' : 'Não existem eventos, pagamentos ou validações pendentes para hoje.'}
        />
        <TimelinePanel
          title="Próximas 48h"
          actionLabel="Ver todas"
          to="/services"
          items={overview.next48Items}
          emptyTitle={loading ? 'A carregar próximos serviços' : 'Sem alertas nas próximas 48h'}
          emptyText={loading ? 'A verificar eventos, equipas e lembretes.' : 'Não existem eventos ou ações operacionais dentro desta janela.'}
        />

        <section className="command-panel command-panel--summary">
          <header>
            <div>
              <BriefcaseBusiness size={18} />
              <h2>Resumo rápido</h2>
            </div>
          </header>
          <div className="command-summary-list">
            {quickItems.map(({ key, label, detail, icon: Icon }) => (
              <div key={key} className="command-summary-row">
                <span>
                  <Icon size={20} />
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
                <b>{overview.quickSummary[key]}</b>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="command-panel command-actions-panel">
        <header>
          <div>
            <CalendarClock size={18} />
            <h2>Ações Pendentes</h2>
          </div>
          <button type="button" onClick={() => setShowAllActions((current) => !current)}>
            {showAllActions ? 'Ver principais ações' : 'Ver todas as ações'}
          </button>
        </header>

        <div className="command-actions-table" role="table" aria-label="Ações pendentes">
          <div className="command-actions-header" role="row">
            <span>Prioridade</span>
            <span>Ação</span>
            <span>Origem</span>
            <span>Prazo</span>
            <span>Estado</span>
            <span>Ação</span>
          </div>
          {tableActions.length ? tableActions.map((action) => (
            <div key={action.id} className="command-actions-row" role="row">
              <span>
                <Badge tone={priorityTones[action.priority] || 'neutral'}>{priorityLabels[action.priority] || action.priority}</Badge>
              </span>
              <div className="command-action-detail">
                <strong>{action.title}</strong>
                {action.details?.length ? (
                  <dl>
                    {action.details.map((item) => (
                      <div key={`${action.id}-${item.label}`}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <small>{action.description}</small>}
              </div>
              <span>{action.origin || action.meta?.[0] || action.category}</span>
              <span>{relativeDueDate(action.dueDate)}</span>
              <span>
                <Badge tone={action.tone || 'neutral'}>{action.category}</Badge>
              </span>
              <Link className="secondary-button" to={action.to}>{action.buttonLabel || actionButtonLabel(action)}</Link>
            </div>
          )) : (
            <div className="command-actions-empty">
              <EmptyState
                icon={search.trim() ? Search : Inbox}
                title={loading ? 'A carregar ações' : search.trim() ? 'Nenhum resultado encontrado' : 'Sem ações pendentes'}
                description={
                  loading
                    ? 'A consolidar eventos, clientes, colaboradores, orçamento e faturação.'
                    : search.trim()
                      ? 'Experimenta outro cliente, evento, colaborador ou tipo de ação.'
                      : 'Quando existir algo a resolver, aparece aqui com ligação direta ao registo certo.'
                }
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
