import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Clock3,
  Euro,
  FileText,
  MessageSquareText,
  Search,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import AttendanceAttentionPanel from '../components/Dashboard/AttendanceAttentionPanel.jsx';
import PendingActionsPanel from '../components/Dashboard/PendingActionsPanel.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { api } from '../utils/api.js';
import { buildDashboardCommandCenter } from '../utils/dashboardCommandCenter.js';
import { date, money } from '../utils/formatters.js';
import { buildPendingActions } from '../utils/pendingActions.js';
import { splitDocumentSnoozes } from '../../shared/dashboardDocumentSnooze.js';

const SNOOZE_PATH = '/notifications/dashboard-documents';
const EMPTY_SNOOZES = [];

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

function formatItemDate(item) {
  if (!item?.date) return '';
  const parsed = new Date(item.date);
  if (Number.isNaN(parsed.getTime())) return '';
  return date.format(parsed);
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
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', [], { revalidateOnFocus: true });
  const { data: collaborators, loading: loadingCollaborators, error: collaboratorsError, reload: reloadCollaborators } = useApi(
    '/collaborators?light=1', [], { revalidateOnFocus: true },
  );
  const { data: budgets, loading: loadingBudgets, error: budgetsError } = useApi('/budgets', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const { user } = useAuth();
  const canSnooze = hasPermission(user, PERMISSIONS.COLLABORATORS_VIEW);
  const { data: snoozes, loading: loadingSnoozes, error: snoozeError, reload: reloadSnoozes } = useApi(
    SNOOZE_PATH, EMPTY_SNOOZES, { enabled: canSnooze, revalidateOnFocus: true },
  );
  const [expiryClock, setExpiryClock] = useState(Date.now);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');

  const actions = useMemo(
    () => buildPendingActions({ services, collaborators, budgets, invoices }),
    [services, collaborators, budgets, invoices],
  );
  const { pending, nextExpiry } = useMemo(() => splitDocumentSnoozes(
    actions, Array.isArray(snoozes) ? snoozes : EMPTY_SNOOZES, expiryClock,
  ), [actions, snoozes, expiryClock]);

  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return undefined;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (Date.now() >= nextExpiry) await reloadCollaborators({ background: true });
      if (!cancelled) setExpiryClock(Date.now());
    }, Math.max(0, Math.min(2147483647, nextExpiry - Date.now())));
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [nextExpiry, expiryClock, reloadCollaborators]);

  const overview = useMemo(
    () => buildDashboardCommandCenter({ services, collaborators, budgets, invoices, actions: pending }),
    [pending, budgets, collaborators, invoices, services],
  );

  const loading = loadingServices || loadingCollaborators || loadingBudgets || loadingInvoices;
  const error = servicesError || collaboratorsError || budgetsError || invoicesError;
  async function snoozeAction(key, duration) {
    const result = await api(SNOOZE_PATH, { method: 'PUT', body: JSON.stringify({ keys: [key], ...duration }) });
    const refreshed = await reloadSnoozes({ background: true });
    if (!Array.isArray(refreshed)) throw new Error('A alteração foi guardada, mas não foi possível atualizar a lista. Atualiza o Dashboard.');
    return result.snoozedUntil;
  }

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
          detail="Eventos finalizados · com IVA"
          tone="success"
        />
      </section>

      <AttendanceAttentionPanel search={search} />

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

      <PendingActionsPanel pending={overview.allPendingActions} search={search}
        loading={loading || loadingSnoozes} canSnooze={canSnooze} snoozeError={snoozeError}
        snoozeReady={!loadingSnoozes && !snoozeError && Array.isArray(snoozes)} onSnooze={snoozeAction} />
    </div>
  );
}
