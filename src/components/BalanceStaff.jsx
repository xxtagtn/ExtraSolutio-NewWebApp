import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Minus, Search, UsersRound, WalletCards } from 'lucide-react';
import BalanceKpi from './BalanceKpi.jsx';
import { buildStaffBalance } from '../utils/balanceStaff.js';
import { durationHours, money } from '../utils/formatters.js';
import { paginateItems } from '../utils/pagination.js';

const evolutionMonths = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function PeriodComparison({ current, previous, format, loading }) {
  const change = Number((current - previous).toFixed(2));
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;
  return <small className="balance-staff-change">
    <span>Anterior: {loading ? '—' : format(previous)}</span>
    <span><Icon size={13} />{loading ? '—' : change ? `${change > 0 ? '+' : '-'}${format(Math.abs(change))}` : 'Sem variação'}</span>
  </small>;
}

export default function BalanceStaff({ services, period, loading, error }) {
  const [collaboratorId, setCollaboratorId] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [evolutionView, setEvolutionView] = useState('annual');
  const [evolutionMonth, setEvolutionMonth] = useState(String(new Date().getMonth() + 1));
  const [evolutionWeek, setEvolutionWeek] = useState('');
  const available = useMemo(() => buildStaffBalance({ services, period, evolutionMonth, evolutionWeek }), [services, period, evolutionMonth, evolutionWeek]);
  const selectedId = available.collaborators.some((row) => row.id === collaboratorId) ? collaboratorId : 'all';
  const analysis = useMemo(() => selectedId === 'all' && !search.trim() ? available
    : buildStaffBalance({ services, period, collaboratorId: selectedId, search, evolutionMonth, evolutionWeek }), [available, period, search, selectedId, services, evolutionMonth, evolutionWeek]);
  const filteredRows = analysis.rows;
  const pagination = paginateItems(filteredRows, page, pageSize === 'all' ? filteredRows.length : pageSize);
  const selectedName = available.collaborators.find((row) => row.id === selectedId)?.name || 'Todos os colaboradores';
  const value = (amount) => loading || error ? '—' : money.format(amount);
  const evolution = analysis.evolution;
  const annual = evolutionView === 'annual';
  const weekly = evolutionView === 'weekly';
  const evolutionTotals = annual ? analysis.annualTotals : weekly ? evolution.weekTotals : evolution.monthTotals;
  const evolutionSeries = annual ? analysis.monthlySeries : weekly ? evolution.weeklySeries : evolution.dailySeries;
  const evolutionPeriod = annual ? period.year : weekly ? `${evolution.activeWeek.label}/${period.year}` : `${evolutionMonths[evolution.month - 1]} ${period.year}`;
  const scope = annual ? 'ano' : weekly ? 'semana' : 'mês';
  const previous = weekly ? evolution.previousWeek : evolution.previousMonth;
  const filterKey = `${period.year}:${period.month}:${period.clientId}:${period.status}:${selectedId}:${search}:${pageSize}`;
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  // Reset only pagination when a query changes; collaborator selection survives month changes.
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setPage(1);
  }

  return (
    <div className="balance-staff" aria-busy={loading}>
      <div className="balance-staff-toolbar">
        <label>Colaborador
          <select aria-label="Colaborador" value={selectedId} onChange={(event) => setCollaboratorId(event.target.value)}>
            <option value="all">Todos os colaboradores</option>
            {available.collaborators.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>Pesquisar colaborador
          <span className="balance-staff-search"><Search size={16} />
            <input type="search" aria-label="Pesquisar colaborador" placeholder="Nome ou NIF" value={search} onChange={(event) => setSearch(event.target.value)} />
          </span>
        </label>
      </div>

      <section className="balance-staff-totals" aria-label="Totais de Staff do período">
        <BalanceKpi icon={UsersRound} label="Custo total" value={value(analysis.totals.cost)} tone="staff" />
        <BalanceKpi icon={CheckCircle2} label="Já pago" value={value(analysis.totals.paid)} tone="finalized" />
        <BalanceKpi icon={WalletCards} label="Por pagar" value={value(analysis.totals.unpaid)} tone="margin" />
      </section>

      <section className="balance-staff-costs">
        <header><h2>Custos por Colaborador</h2><small>Por data do serviço · Serviços validados</small></header>
        <table className="balance-staff-table">
          <thead><tr><th>Colaborador</th><th>Serviços</th><th>Horas</th><th>Custo total</th><th>Já pago</th><th>Por pagar</th></tr></thead>
          <tbody>
            {!loading && !error ? pagination.items.map((row) => (
              <tr key={row.id}>
                <td data-label="Colaborador"><button type="button" className="balance-staff-name" onClick={() => setCollaboratorId(row.id)} title={`Evolução de ${row.name}`}>{row.name}</button><small>NIF {row.nif}</small></td>
                <td data-label="Serviços">{row.services}</td>
                <td data-label="Horas">{durationHours(row.hours)}</td>
                <td data-label="Custo total">{money.format(row.cost)}</td>
                <td data-label="Já pago">{money.format(row.paid)}</td>
                <td data-label="Por pagar">{money.format(row.unpaid)}</td>
              </tr>
            )) : null}
          </tbody>
        </table>
        {loading ? <p className="muted">A carregar...</p> : null}
        {!loading && error ? <p className="muted">Análise de Staff indisponível.</p> : null}
        {!loading && !error && !filteredRows.length ? <p className="muted">Sem custos de staff para os filtros selecionados.</p> : null}
        {!loading && !error && pagination.totalItems ? (
          <footer className="balance-staff-pagination">
            <span>A mostrar {pagination.startItem}-{pagination.endItem} de {pagination.totalItems}</span>
            <label>Por página <select aria-label="Colaboradores por página" value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
              {['10', '20', '50', 'all'].map((size) => <option key={size} value={size}>{size === 'all' ? 'Tudo' : size}</option>)}
            </select></label>
            <nav aria-label="Paginação dos custos por colaborador">
              <button type="button" className="icon-button" aria-label="Página anterior de Staff" disabled={pagination.currentPage <= 1} onClick={() => setPage(pagination.currentPage - 1)}><ChevronLeft size={16} /></button>
              <span>{pagination.currentPage} / {pagination.totalPages}</span>
              <button type="button" className="icon-button" aria-label="Página seguinte de Staff" disabled={pagination.currentPage >= pagination.totalPages} onClick={() => setPage(pagination.currentPage + 1)}><ChevronRight size={16} /></button>
            </nav>
          </footer>
        ) : null}
        <p className="balance-staff-note">Já pago e por pagar: saldo após adiantamentos. Penhorado e Ganho não são pagamentos concluídos.</p>
      </section>

      <section className="balance-staff-evolution">
        <header><div><h2>Evolução de Staff</h2><small>{selectedName} · {evolutionPeriod} · Por data do serviço</small></div>
          <div className="balance-staff-view" role="group" aria-label="Vista da evolução de Staff">
            {[['annual', 'Anual'], ['monthly', 'Mensal'], ['weekly', 'Semanal']].map(([key, label]) => <button key={key} type="button" aria-pressed={evolutionView === key} onClick={() => setEvolutionView(key)}>{label}</button>)}
          </div>
        </header>
        {!annual ? <div className="balance-staff-evolution-filters">
          {!period.month ? <label>Mês da evolução<select aria-label="Mês da evolução" value={evolution.month} onChange={(event) => { setEvolutionMonth(event.target.value); setEvolutionWeek(''); }}>
            {evolutionMonths.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select></label> : null}
          {weekly ? <label>Semana<select aria-label="Semana da evolução" value={evolution.activeWeek.start} onChange={(event) => setEvolutionWeek(event.target.value)}>
            {evolution.weeks.map((week) => <option key={week.start} value={week.start}>{week.label}</option>)}
          </select></label> : null}
        </div> : null}
        {!annual ? <p className="balance-staff-comparison-period">Comparação com {previous.label}</p> : null}
        <div className="balance-staff-annual" aria-label={`Totais de Staff no ${scope}`}>
          <div><span>Custo {annual ? 'anual' : weekly ? 'semanal' : 'mensal'}</span><strong>{value(evolutionTotals.cost)}</strong>
            {!annual ? <PeriodComparison current={evolutionTotals.cost} previous={previous.totals.cost} format={(amount) => money.format(amount)} loading={loading || error} /> : null}
          </div>
          <div><span>Serviços {weekly ? 'na' : 'no'} {scope}</span><strong>{loading || error ? '—' : evolutionTotals.services}</strong>
            {!annual ? <PeriodComparison current={evolutionTotals.services} previous={previous.totals.services} format={String} loading={loading || error} /> : null}
          </div>
          <div><span>Horas {weekly ? 'na' : 'no'} {scope}</span><strong>{loading || error ? '—' : durationHours(evolutionTotals.hours)}</strong>
            {!annual ? <PeriodComparison current={evolutionTotals.hours} previous={previous.totals.hours} format={durationHours} loading={loading || error} /> : null}
          </div>
        </div>
        {!loading && !error ? (
          <>
            <div className="balance-chart-legend"><span><i className="legend-revenue" />Custo total</span><span><i className="legend-client-margin" />Já pago</span></div>
            <div className="balance-staff-chart">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={evolutionSeries} margin={{ top: 12, right: 8, left: 6, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                  <XAxis dataKey={annual ? 'month' : 'label'} stroke="#8da0aa" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis width="auto" stroke="#8da0aa" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(amount) => amount >= 1000 ? `${amount / 1000}k €` : money.format(amount)} />
                  <Tooltip contentStyle={{ background: '#11181c', border: '1px solid #26343a', borderRadius: 6 }} formatter={(amount, name) => [money.format(Number(amount)), name]} />
                  <Bar dataKey="cost" name="Custo total" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Line dataKey="paid" name="Já pago" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details className="balance-staff-months"><summary>Detalhe {annual ? 'mensal' : 'diário'} · {evolutionPeriod}</summary>
              <table className="balance-staff-table"><thead><tr><th>{annual ? 'Mês' : 'Dia'}</th><th>Serviços</th><th>Horas</th><th>Custo total</th><th>Já pago</th><th>Por pagar</th></tr></thead><tbody>
                {evolutionSeries.map((row) => <tr key={annual ? row.month : row.day}>
                  <td data-label={annual ? 'Mês' : 'Dia'}>{annual ? row.month : row.label}</td><td data-label="Serviços">{row.services}</td><td data-label="Horas">{durationHours(row.hours)}</td><td data-label="Custo total">{money.format(row.cost)}</td><td data-label="Já pago">{money.format(row.paid)}</td><td data-label="Por pagar">{money.format(row.unpaid)}</td>
                </tr>)}
              </tbody></table>
            </details>
          </>
        ) : null}
      </section>
    </div>
  );
}
