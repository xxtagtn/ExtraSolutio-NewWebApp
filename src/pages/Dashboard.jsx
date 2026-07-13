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
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { buildBalanceOverview, buildClientBalanceSeries } from '../utils/balanceMetrics.js';
import { availableFinancialYears } from '../utils/dashboardMetrics.js';
import { date, money } from '../utils/formatters.js';
import { SERVICE_STATUS, statusLabel } from '../utils/serviceStatus.js';

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

function deltaFor(series, month, field) {
  if (!month) return 0;
  const monthIndex = Math.max(0, Number(month || 0) - 1);
  const current = series[monthIndex]?.[field] || 0;
  const previous = series[monthIndex - 1]?.[field] || 0;
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
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

function KpiCard({ icon: Icon, label, value, detail, tone = 'accent' }) {
  return (
    <article className={`balance-kpi balance-kpi--${tone}`}>
      <span className="balance-kpi__icon"><Icon size={22} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
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
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: clients, loading: loadingClients, error: clientsError } = useApi('/clients', []);
  const { data: invoices } = useApi('/invoices', []);
  const { data: transactions } = useApi('/transactions', []);
  const initialPeriod = useMemo(() => currentPeriod(), []);
  const [selectedMonth, setSelectedMonth] = useState(initialPeriod.month);
  const [selectedYear, setSelectedYear] = useState(initialPeriod.year);
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [activeSection, setActiveSection] = useState('clients');
  const [activeClientKey, setActiveClientKey] = useState('');

  const yearOptions = useMemo(
    () => Array.from(new Set([initialPeriod.year, ...availableFinancialYears(services, invoices, transactions)]))
      .sort((a, b) => Number(b) - Number(a)),
    [initialPeriod.year, invoices, services, transactions],
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
  const loading = loadingServices || loadingClients;
  const error = servicesError || clientsError;
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
      </header>

      {error ? <p className="notice">{error}</p> : null}

      <section className="balance-filter-panel" aria-label="Filtros do Balancete">
        <label>
          <span>Mês</span>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {monthOptions.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Ano</span>
          <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
            {yearOptions.length ? yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            )) : <option value={selectedYear}>{selectedYear}</option>}
          </select>
        </label>
        <label>
          <span>Cliente</span>
          <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
            <option value="all">Todos os clientes</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
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
        <>
          <section className="balance-kpi-grid">
            <KpiCard
              icon={CircleDollarSign}
              label="Receita validada"
              value={money.format(overview.kpis.validatedRevenue)}
              detail={selectedMonth
                ? `vs. ${selectedMonthName(Number(selectedMonth) - 1 || 12).toLowerCase()} ${formatDelta(deltaFor(overview.monthlySeries, selectedMonth, 'receita'))}`
                : 'Total do ano selecionado'}
              tone="revenue"
            />
            <KpiCard
              icon={UsersRound}
              label="Staff a pagar"
              value={money.format(overview.kpis.staffToPay)}
              detail={selectedMonth
                ? `vs. ${selectedMonthName(Number(selectedMonth) - 1 || 12).toLowerCase()} ${formatDelta(deltaFor(overview.monthlySeries, selectedMonth, 'staff'))}`
                : 'Total do ano selecionado'}
              tone="staff"
            />
            <KpiCard
              icon={TrendingUp}
              label="Margem real"
              value={money.format(overview.kpis.realMargin)}
              detail={selectedMonth
                ? `vs. ${selectedMonthName(Number(selectedMonth) - 1 || 12).toLowerCase()} ${formatDelta(deltaFor(overview.monthlySeries, selectedMonth, 'margem'))}`
                : 'Total do ano selecionado'}
              tone="margin"
            />
            <KpiCard
              icon={WalletCards}
              label="Por receber"
              value={money.format(overview.kpis.receivable)}
              detail={`${overview.alerts.clientsOpen.count} cliente(s) com valor em aberto`}
              tone="receivable"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Eventos finalizados"
              value={overview.kpis.finalizedEvents}
              detail={`${totalEvents} evento(s) no período`}
              tone="finalized"
            />
          </section>

          <section className="balance-main-grid">
            <article className="balance-panel balance-chart-panel">
              <header>
                <div>
                  <h2>Evolução mensal</h2>
                  <small>{selectedYear}</small>
                </div>
                <div className="balance-chart-legend">
                  <span><i className="legend-revenue" />Receita</span>
                  <span><i className="legend-staff" />Custos</span>
                  <span><i className="legend-margin" />Margem</span>
                </div>
              </header>
              <div className="balance-chart">
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={overview.monthlySeries} margin={{ top: 10, right: 8, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                    <XAxis dataKey="month" stroke="#8da0aa" tickLine={false} axisLine={false} />
                    <YAxis stroke="#8da0aa" tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k €`} />
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
                <div><span>Total receita</span><strong>{money.format(overview.kpis.validatedRevenue)}</strong></div>
                <div><span>Total staff</span><strong>{money.format(overview.kpis.staffToPay)}</strong></div>
                <div><span>Margem real</span><strong>{money.format(overview.kpis.realMargin)}</strong></div>
                <div><span>Margem %</span><strong>{formatPercent(marginPercent)}</strong></div>
              </footer>
            </article>

            <article className="balance-panel balance-alert-panel">
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
          </section>
        </>
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
                <div><span>Custos</span><strong>{money.format((activeClient?.staff || 0) + (activeClient?.external || 0))}</strong></div>
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
