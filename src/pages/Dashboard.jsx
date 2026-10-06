import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { buildBalanceOverview, buildClientBalanceSeries } from '../utils/balanceMetrics.js';
import { balanceChartWindow, balanceMonthComparison, buildBalanceAttention, buildBalanceForecast } from '../utils/balanceOverviewPresentation.js';
import { availableFinancialYears } from '../utils/dashboardMetrics.js';
import { date, money } from '../utils/formatters.js';
import { SERVICE_STATUS, statusLabel } from '../utils/serviceStatus.js';
import './balanceOverview.css';

const monthOptions = [
  ['', 'Todos os meses'],
  ['1', 'Janeiro'],
  ['2', 'Fevereiro'],
  ['3', 'Março'],
  ['4', 'Abril'],
  ['5', 'Maio'],
  ['6', 'Junho'],
  ['7', 'Julho'],
  ['8', 'Agosto'],
  ['9', 'Setembro'],
  ['10', 'Outubro'],
  ['11', 'Novembro'],
  ['12', 'Dezembro'],
];

const statusOptions = [
  ['all', 'Todos os estados'],
  [SERVICE_STATUS.finalized, 'Finalizado'],
  ['confirmed', 'Confirmado'],
  [SERVICE_STATUS.toValidateClient, 'Em validação'],
  [SERVICE_STATUS.toValidateStaff, 'Por validar Staff'],
  [SERVICE_STATUS.inProgress, 'Em execução'],
  [SERVICE_STATUS.teamComplete, 'Equipa completa'],
  [SERVICE_STATUS.drafting, 'A preencher'],
];

const balanceSections = [
  ['overview', 'Visão geral'],
  ['clients', 'Clientes'],
  ['events', 'Eventos'],
];

function currentPeriod() {
  const now = new Date();
  return {
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
  };
}

function selectedMonthName(value) {
  return monthOptions.find(([month]) => month === String(value))?.[1] || 'Todos os meses';
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-PT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatDelta(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatPercent(value)}`;
}

function comparisonLabel(series, month, field) {
  const delta = balanceMonthComparison(series, month, field);
  return delta === null ? (month ? 'No período selecionado' : 'Total do ano selecionado')
    : `${formatDelta(delta)} vs. ${selectedMonthName(Number(month) - 1).toLowerCase()}`;
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'finalized' || normalized === 'paid' || normalized === 'completed' || normalized === 'invoiced') return 'success';
  if (normalized === 'confirmed' || normalized === 'team_complete') return 'info';
  if (normalized === 'to_validate_client' || normalized === 'to_validate_staff') return 'warning';
  return 'neutral';
}

function statusText(status) {
  if (String(status || '').toLowerCase() === SERVICE_STATUS.toValidateClient) return 'Em validação';
  return statusLabel(status);
}

function clientStateLabel(state) {
  if (state === 'overdue') return 'Em atraso';
  if (state === 'open') return 'A vencer';
  return 'Regularizado';
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'accent', onClick, expanded }) {
  const Element = onClick ? 'button' : 'article';
  return (
    <Element className={`balance-kpi balance-kpi--${tone}`} {...(onClick ? {
      type: 'button', onClick, 'aria-expanded': expanded, 'aria-controls': 'balance-margin-detail',
    } : {})}>
      <span className="balance-kpi__icon"><Icon size={22} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}{onClick ? <ChevronDown size={13} /> : null}</small> : null}
      </div>
    </Element>
  );
}

function FinancialDetailList({ rows, empty }) {
  return (
    <div className="balance-detail-list">
      {rows.map((row) => (
        <Link key={row.key} to={row.to}>
          <span><strong>{row.title}</strong><small>{row.subtitle}{row.date ? ` · ${date.format(new Date(row.date))}` : ''}</small></span>
          <b>{money.format(row.amount)}</b><ArrowRight size={15} />
        </Link>
      ))}
      {!rows.length ? <p>{empty}</p> : null}
    </div>
  );
}

function AlertItem({ icon: Icon, tone, title, badge, detail, actionLabel, to }) {
  return (
    <Link className={`balance-alert balance-alert--${tone}`} to={to}>
      <span className="balance-alert__icon"><Icon size={22} /></span>
      <div>
        <strong>{title} <em>{badge}</em></strong>
        <small>{detail}</small>
      </div>
      <span>{actionLabel}</span>
      <ArrowRight size={16} />
    </Link>
  );
}

function BalanceTabs({ active, onChange }) {
  return (
    <nav className="balance-tabs service-tabs" aria-label="Áreas do Balancete">
      {balanceSections.map(([key, label]) => (
        <button
          type="button"
          key={key}
          className={`service-tab ${active === key ? 'service-tab--active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function EventsTable({ rows, loading }) {
  return (
    <section className="balance-panel balance-events-panel">
      <header>
        <h2>Eventos do período</h2>
      </header>
      <div className="balance-events-table" role="table" aria-label="Eventos do período">
        <div className="balance-events-header balance-events-header--costs" role="row">
          <span>Evento</span>
          <span>Cliente</span>
          <span>Data</span>
          <span>Receita</span>
          <span>Staff</span>
          <span>Custos externos</span>
          <span>Margem</span>
          <span>Estado</span>
          <span />
        </div>
        {rows.map((row) => (
          <Link className="balance-event-row balance-event-row--costs" key={row.id} to={`/services/${row.id}`} role="row">
            <strong>{row.eventName}</strong>
            <span>{row.clientName}</span>
            <span><CalendarDays size={14} />{row.date ? date.format(row.date) : '-'}</span>
            <span>{money.format(row.revenue)}</span>
            <span>{money.format(row.staff)}</span>
            <span>{money.format(row.external)}</span>
            <span>{money.format(row.margin)} <b>{formatPercent(row.marginPct)}</b></span>
            <span><em className={`balance-status balance-status--${statusTone(row.rawStatus)}`}>{statusText(row.rawStatus)}</em></span>
            <ArrowRight size={16} />
          </Link>
        ))}
        {loading ? <div className="balance-events-empty">A carregar...</div> : null}
        {!loading && rows.length === 0 ? (
          <div className="balance-events-empty">Sem eventos para os filtros selecionados.</div>
        ) : null}
      </div>
      <footer className="balance-events-footer">
        <span>A mostrar 1-{rows.length} de {rows.length} eventos</span>
        <div>
          <span>Linhas por página</span>
          <select value="10" disabled>
            <option>10</option>
          </select>
          <button type="button" className="icon-button" disabled aria-label="Página anterior"><ChevronLeft size={15} /></button>
          <button type="button" className="icon-button is-active" aria-label="Página 1">1</button>
          <button type="button" className="icon-button" disabled aria-label="Página seguinte"><ChevronRight size={15} /></button>
        </div>
      </footer>
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const canViewBudgets = hasPermission(user, PERMISSIONS.BUDGETS_VIEW);
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: clients, loading: loadingClients, error: clientsError } = useApi('/clients', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const { data: budgets, loading: loadingBudgets, error: budgetsError } = useApi('/budgets', [], { enabled: canViewBudgets });
  const { data: transactions } = useApi('/transactions', []);
  const initialPeriod = useMemo(() => currentPeriod(), []);
  const [selectedMonth, setSelectedMonth] = useState(initialPeriod.month);
  const [selectedYear, setSelectedYear] = useState(initialPeriod.year);
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [activeSection, setActiveSection] = useState('overview');
  const [activeClientKey, setActiveClientKey] = useState('');
  const [marginOpen, setMarginOpen] = useState(true);
  const [activeAttention, setActiveAttention] = useState('');

  const yearOptions = useMemo(
    () => Array.from(new Set([initialPeriod.year, ...availableFinancialYears(services, invoices, transactions,
      budgets.map((budget) => ({ date: budget.eventDate })))]))
      .sort((a, b) => Number(b) - Number(a)),
    [budgets, initialPeriod.year, invoices, services, transactions],
  );

  const period = useMemo(() => ({
    month: selectedMonth,
    year: selectedYear,
    clientId: selectedClientId,
    status: selectedStatus,
  }), [selectedClientId, selectedMonth, selectedStatus, selectedYear]);

  const overview = useMemo(
    () => buildBalanceOverview({ services, invoices, period }),
    [invoices, period, services],
  );
  const attention = useMemo(() => buildBalanceAttention({ eventRows: overview.eventRows, invoices, clients }),
    [clients, invoices, overview.eventRows]);
  const forecast = useMemo(() => buildBalanceForecast({ eventRows: overview.eventRows, budgets, period }),
    [budgets, overview.eventRows, period]);
  const chartSeries = balanceChartWindow(overview.monthlySeries, selectedMonth);
  const periodLabel = `${selectedMonth ? selectedMonthName(selectedMonth) : 'Ano de'} ${selectedYear}`;
  const attentionItems = [
    { key: 'overdue', label: 'Clientes em atraso', icon: AlertCircle },
    { key: 'staff', label: 'Staff por pagar', icon: UsersRound },
    { key: 'unbilled', label: 'Serviços por faturar', icon: WalletCards },
  ];

  useEffect(() => {
    if (overview.clientRows.some((row) => row.key === activeClientKey)) return;
    setActiveClientKey(overview.clientRows[0]?.key || '');
  }, [activeClientKey, overview.clientRows]);

  const activeClient = overview.clientRows.find((row) => row.key === activeClientKey) || overview.clientRows[0] || null;
  const clientSeries = useMemo(
    () => buildClientBalanceSeries(overview.annualRows, activeClient?.key || ''),
    [activeClient?.key, overview.annualRows],
  );

  const marginPercent = overview.kpis.validatedRevenue > 0
    ? (overview.kpis.realMargin / overview.kpis.validatedRevenue) * 100
    : 0;
  const totalEvents = overview.eventRows.length;
  const loading = loadingServices || loadingClients || loadingInvoices;
  const error = servicesError || clientsError || invoicesError;
  const financialValue = (value) => loading || error ? '—' : money.format(value);
  const clientAttentionRows = [
    ...overview.clientRows.filter((row) => row.overdueDays > 0).slice(0, 2),
    ...overview.clientRows.filter((row) => row.marginPct < 20 && row.revenue > 0).slice(0, 2),
  ].filter((row, index, source) => source.findIndex((item) => item.key === row.key) === index).slice(0, 3);

  function resetToCurrentPeriod() {
    const next = currentPeriod();
    setSelectedMonth(next.month);
    setSelectedYear(next.year);
    setSelectedClientId('all');
    setSelectedStatus('all');
  }

  return (
    <div className="page balance-page">
      <header className="balance-title">
        <div>
          <h1>Balancete</h1>
          <p>Resumo financeiro por período</p>
        </div>
        <span className="balance-period-label"><CalendarDays size={20} />{periodLabel}</span>
      </header>

      {error ? <p className="notice">{error}</p> : null}

      <section className="balance-filter-panel" aria-label="Filtros do Balancete">
        <label>
          <span>Mês</span>
          <select aria-label="Mês" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {monthOptions.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Ano</span>
          <select aria-label="Ano" value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
            {yearOptions.length ? yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            )) : <option value={selectedYear}>{selectedYear}</option>}
          </select>
        </label>
        <label>
          <span>Cliente</span>
          <select aria-label="Cliente" value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
            <option value="all">Todos os clientes</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select aria-label="Estado" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="command-button balance-current-button" onClick={resetToCurrentPeriod}>
          <RefreshCw size={16} />
          Atual
        </button>
      </section>

      <BalanceTabs active={activeSection} onChange={setActiveSection} />

      {activeSection === 'overview' ? (
        <div className="balance-overview" aria-busy={loading}>
          <section className="balance-kpi-grid">
            <KpiCard
              icon={CircleDollarSign}
              label="Receita do período"
              value={loading || error ? '—' : money.format(overview.kpis.validatedRevenue)}
              detail={loading || error ? 'No período selecionado' : comparisonLabel(overview.monthlySeries, selectedMonth, 'receita')}
              tone="revenue"
            />
            <KpiCard
              icon={UsersRound}
              label="Custo do staff"
              value={loading || error ? '—' : money.format(overview.kpis.staffToPay)}
              detail={loading || error ? 'No período selecionado' : comparisonLabel(overview.monthlySeries, selectedMonth, 'staff')}
              tone="staff"
            />
            <KpiCard
              icon={TrendingUp}
              label="Margem do período"
              value={loading || error ? '—' : money.format(overview.kpis.realMargin)}
              detail={`${loading || error ? '—' : formatPercent(marginPercent)} · Composição`}
              onClick={() => setMarginOpen((open) => !open)}
              expanded={marginOpen}
              tone="margin"
            />
            <KpiCard
              icon={WalletCards}
              label="Por receber"
              value={loading || error ? '—' : money.format(overview.kpis.receivable)}
              detail={loading || error ? 'A consultar faturas' : `${overview.alerts.clientsOpen.count} cliente(s) com valor em aberto`}
              tone="receivable"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Eventos finalizados"
              value={loading || error ? '—' : overview.kpis.finalizedEvents}
              detail={loading || error ? 'No período selecionado' : `${totalEvents} evento(s) no período`}
              tone="finalized"
            />
          </section>

          <section className="balance-attention-strip" aria-label="A acompanhar">
            <h2><AlertCircle size={21} />A acompanhar</h2>
            {attentionItems.map(({ key, label, icon: Icon }) => (
              <button type="button" key={key} className={`balance-attention-item balance-attention-item--${key}`}
                aria-expanded={activeAttention === key} aria-controls="balance-attention-detail"
                disabled={loading || Boolean(error)} onClick={() => setActiveAttention((active) => active === key ? '' : key)}>
                <Icon size={22} /><span><small>{label}</small><strong>{loading || error ? '—' : money.format(attention[key].amount)}</strong></span><ChevronRight size={17} />
              </button>
            ))}
          </section>
          {activeAttention ? (
            <section className="balance-attention-detail" id="balance-attention-detail">
              <header><div><h2>{attentionItems.find((item) => item.key === activeAttention)?.label}</h2>
                <small>Eventos do período selecionado{activeAttention !== 'overdue' ? ' · concluídos/validados' : ''}</small></div>
                <button className="icon-button" type="button" aria-label="Fechar pendências" onClick={() => setActiveAttention('')}><X size={17} /></button></header>
              <FinancialDetailList rows={attention[activeAttention].rows} empty="Sem pendências para estes filtros." />
            </section>
          ) : null}

          <section className={`balance-main-grid balance-main-grid--minimal ${marginOpen ? '' : 'balance-main-grid--wide'}`}>
            <article className="balance-panel balance-chart-panel">
              <header>
                <div>
                  <h2>Evolução mensal</h2>
                  <small>{selectedMonth ? `${chartSeries[0]?.month} – ${chartSeries.at(-1)?.month} ${selectedYear}` : selectedYear}</small>
                </div>
                <div className="balance-chart-legend">
                  <span><i className="legend-revenue" />Receita</span>
                  <span><i className="legend-staff" />Custos</span>
                  <span><i className="legend-margin" />Margem</span>
                </div>
              </header>
              <div className="balance-chart">
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={chartSeries} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                    <XAxis dataKey="month" stroke="#8da0aa" tickLine={false} axisLine={false} minTickGap={16} tick={{ fontSize: 12 }} />
                    <YAxis width={48} stroke="#8da0aa" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => `${Number(value) / 1000}k €`} />
                    <Tooltip
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      contentStyle={{ background: '#11181c', border: '1px solid #26343a', borderRadius: 8 }}
                      formatter={(value, name) => [money.format(Number(value || 0)), name]}
                    />
                    <Bar dataKey="receita" name="Receita" fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={13} />
                    <Bar dataKey="custos" name="Custos" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={13} />
                    <Line dataKey="margem" name="Margem" stroke="#f59e0b" strokeWidth={2.4} dot={{ r: 4, fill: '#fbbf24' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <footer className="balance-chart-summary">
                <div><span>Receita</span><strong>{financialValue(overview.kpis.validatedRevenue)}</strong></div>
                <div><span>Custos</span><strong>{financialValue(overview.kpis.staffToPay + overview.kpis.externalCosts + overview.kpis.taxCosts)}</strong></div>
                <div><span>Margem</span><strong>{financialValue(overview.kpis.realMargin)}</strong></div>
              </footer>
            </article>

            {marginOpen ? <aside className="balance-margin-detail" id="balance-margin-detail">
              <header><div><h2>Composição da margem</h2><small>{periodLabel}</small></div>
                <button type="button" className="icon-button" aria-label="Fechar composição da margem" onClick={() => setMarginOpen(false)}><X size={18} /></button></header>
              <dl>
                <div><dt>Receita do período</dt><dd>{financialValue(overview.kpis.validatedRevenue)}</dd></div>
                <div><dt>Custo do staff</dt><dd>{financialValue(-overview.kpis.staffToPay || 0)}</dd></div>
                <div><dt>Custos externos</dt><dd>{financialValue(-overview.kpis.externalCosts || 0)}</dd></div>
                <div><dt>Impostos considerados</dt><dd>{financialValue(-overview.kpis.taxCosts || 0)}</dd></div>
                <div className="balance-margin-total"><dt>Margem do período</dt><dd>{financialValue(overview.kpis.realMargin)}</dd></div>
                <div><dt>Margem sobre a receita</dt><dd>{loading || error ? '—' : formatPercent(marginPercent)}</dd></div>
              </dl>
            </aside> : null}
          </section>

          <details className="balance-forecast">
            <summary><CalendarDays size={20} /><strong>Previsões do período</strong>
              <span>Confirmado: <b>{financialValue(forecast.confirmed.amount)}</b></span>
              {canViewBudgets ? <span>Em análise: <b>{loadingBudgets || budgetsError ? '—' : money.format(forecast.budgets.amount)}</b></span> : null}
              <ChevronDown size={18} /></summary>
            <div className="balance-forecast-body">
              <section><h2>Eventos confirmados</h2><FinancialDetailList rows={forecast.confirmed.rows} empty="Sem eventos confirmados para estes filtros." /></section>
              {canViewBudgets ? <section><h2>Orçamentos em análise</h2>{budgetsError ? <p className="notice">{budgetsError}</p> : loadingBudgets ? <p>A carregar...</p>
                : <FinancialDetailList rows={forecast.budgets.rows} empty={selectedStatus !== 'all' ? 'Selecione Todos os estados para consultar orçamentos.' : 'Sem orçamentos em análise para estes filtros.'} />}</section> : null}
            </div>
          </details>

          <details className="balance-management-alerts">
            <summary>Alertas de gestão <ChevronDown size={16} /></summary>
            <article className="balance-alert-panel">
              <header><h2>Alertas de gestão</h2></header>
              <div className="balance-alert-list">
                <AlertItem
                  icon={TrendingDown}
                  tone="warning"
                  title="Margem baixa"
                  badge={`${overview.alerts.lowMarginEvents.count} eventos`}
                  detail="Existem eventos com margem abaixo de 20%."
                  actionLabel="Ver eventos"
                  to="/finance?area=margins"
                />
                <AlertItem
                  icon={WalletCards}
                  tone="info"
                  title="Clientes com valor em aberto"
                  badge={`${overview.alerts.clientsOpen.count} clientes`}
                  detail={`Total por receber: ${money.format(overview.alerts.clientsOpen.value)}`}
                  actionLabel="Ver clientes"
                  to="/finance?area=clients"
                />
                <AlertItem
                  icon={UsersRound}
                  tone="warning"
                  title="Staff por processar"
                  badge={`${overview.alerts.staffToProcess.count} eventos`}
                  detail="Eventos concluídos com staff por processar."
                  actionLabel="Ver eventos"
                  to="/finance?area=staff"
                />
              </div>
            </article>
          </details>
        </div>
      ) : null}

      {activeSection === 'clients' ? (
        <>
          <section className="balance-client-kpi-grid">
            <KpiCard icon={TrendingUp} label="Receita validada" value={money.format(overview.kpis.validatedRevenue)} tone="revenue" />
            <KpiCard icon={WalletCards} label="Por receber" value={money.format(overview.kpis.receivable)} tone="receivable" />
            <KpiCard icon={CircleDollarSign} label="Margem média" value={formatPercent(marginPercent)} tone="margin" />
            <KpiCard icon={AlertCircle} label="Clientes em atraso" value={overview.kpis.overdueClients} tone="overdue" />
          </section>

          <section className="balance-client-main-grid">
            <article className="balance-panel balance-client-table-panel">
              <header><h2>Rentabilidade por cliente</h2></header>
              <div className="balance-client-table" role="table" aria-label="Rentabilidade por cliente">
                <div className="balance-client-table__head" role="row">
                  <span>Cliente</span><span>Eventos</span><span>Receita</span><span>Staff</span><span>Custos externos</span><span>Margem</span><span>Em aberto</span><span>Próximo vencimento</span><span>Estado</span>
                </div>
                {overview.clientRows.map((row) => (
                  <button
                    type="button"
                    role="row"
                    key={row.key}
                    className={`balance-client-row ${activeClient?.key === row.key ? 'balance-client-row--active' : ''}`}
                    onClick={() => setActiveClientKey(row.key)}
                  >
                    <strong>{row.clientName}</strong>
                    <span>{row.eventCount}</span>
                    <span>{money.format(row.revenue)}</span>
                    <span>{money.format(row.staff)}</span>
                    <span>{money.format(row.external)}</span>
                    <span className="balance-client-margin">
                      <b>{formatPercent(row.marginPct)}</b>
                      <i><em style={{ width: `${Math.max(0, Math.min(100, row.marginPct))}%` }} /></i>
                    </span>
                    <span className={row.receivable > 0 ? 'balance-value-open' : ''}>{money.format(row.receivable)}</span>
                    <span>{row.nextDueDate ? date.format(row.nextDueDate) : '-'}</span>
                    <span><em className={`balance-client-state balance-client-state--${row.state}`}>{clientStateLabel(row.state)}</em></span>
                  </button>
                ))}
                {!loading && overview.clientRows.length === 0 ? <div className="balance-events-empty">Sem clientes para os filtros selecionados.</div> : null}
              </div>
            </article>

            <aside className="balance-panel balance-client-attention">
              <header><h2>Atenção</h2></header>
              <div className="balance-client-attention__list">
                {clientAttentionRows.map((row) => (
                  <Link key={row.key} to={`/finance?area=clients${row.clientId ? `&clientId=${row.clientId}` : ''}`}>
                    <AlertCircle size={20} />
                    <span>
                      <strong>{row.overdueDays > 0 ? 'Cliente em atraso' : 'Margem baixa'}</strong>
                      <small>{row.clientName}</small>
                      <b>{row.overdueDays > 0 ? `Em aberto: ${money.format(row.receivable)}` : `Margem: ${formatPercent(row.marginPct)}`}</b>
                    </span>
                    <em>Abrir</em>
                  </Link>
                ))}
                {!clientAttentionRows.length ? <p className="balance-client-attention__empty">Sem alertas para este período.</p> : null}
              </div>
            </aside>
          </section>

          <section className="balance-panel balance-client-evolution">
            <header>
              <div>
                <h2>Evolução do cliente selecionado</h2>
                <small>{selectedYear}</small>
              </div>
              <select value={activeClient?.key || ''} onChange={(event) => setActiveClientKey(event.target.value)} disabled={!overview.clientRows.length}>
                {overview.clientRows.length ? overview.clientRows.map((row) => <option key={row.key} value={row.key}>{row.clientName}</option>) : <option value="">Sem clientes</option>}
              </select>
            </header>
            <div className="balance-client-evolution__body">
              <div>
                <div className="balance-chart-legend balance-client-evolution__legend">
                  <span><i className="legend-revenue" />Receita (€)</span>
                  <span><i className="legend-margin" />Custos (€)</span>
                  <span><i className="legend-client-margin" />Margem (%)</span>
                </div>
                <div className="balance-client-chart">
                  <ResponsiveContainer width="100%" height={245}>
                    <ComposedChart data={clientSeries} margin={{ top: 10, right: 12, left: 2, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                      <XAxis dataKey="month" stroke="#8da0aa" tickLine={false} axisLine={false} />
                      <YAxis yAxisId="money" stroke="#8da0aa" tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k €`} />
                      <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} stroke="#8da0aa" tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                      <Tooltip
                        cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                        contentStyle={{ background: '#11181c', border: '1px solid #26343a', borderRadius: 8 }}
                        formatter={(value, name) => [name === 'Margem (%)' ? formatPercent(value) : money.format(Number(value || 0)), name]}
                      />
                      <Bar yAxisId="money" dataKey="receita" name="Receita" fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={18} />
                      <Bar yAxisId="money" dataKey="custos" name="Custos" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={18} />
                      <Line yAxisId="percent" dataKey="margemPct" name="Margem (%)" stroke="#2dd4bf" strokeDasharray="5 5" strokeWidth={2.2} dot={{ r: 3, fill: '#2dd4bf' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <aside>
                <div><span>Receita</span><strong>{money.format(activeClient?.revenue || 0)}</strong></div>
                <div><span>Custos</span><strong>{money.format((activeClient?.staff || 0) + (activeClient?.external || 0) + (activeClient?.tax || 0))}</strong></div>
                <div><span>Margem média</span><strong>{formatPercent(activeClient?.marginPct || 0)}</strong></div>
              </aside>
            </div>
          </section>
        </>
      ) : null}

      {activeSection === 'events' ? <EventsTable rows={overview.eventRows} loading={loading} /> : null}
    </div>
  );
}
