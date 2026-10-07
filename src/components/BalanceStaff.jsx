import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, ChevronLeft, ChevronRight, Search, UsersRound, WalletCards } from 'lucide-react';
import BalanceKpi from './BalanceKpi.jsx';
import { buildStaffBalance } from '../utils/balanceStaff.js';
import { durationHours, money } from '../utils/formatters.js';
import { paginateItems } from '../utils/pagination.js';

export default function BalanceStaff({ services, period, loading, error }) {
  const [collaboratorId, setCollaboratorId] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const available = useMemo(() => buildStaffBalance({ services, period }), [services, period]);
  const selectedId = available.collaborators.some((row) => row.id === collaboratorId) ? collaboratorId : 'all';
  const analysis = useMemo(() => selectedId === 'all' && !search.trim() ? available
    : buildStaffBalance({ services, period, collaboratorId: selectedId, search }), [available, period, search, selectedId, services]);
  const filteredRows = analysis.rows;
  const pagination = paginateItems(filteredRows, page, pageSize === 'all' ? filteredRows.length : pageSize);
  const selectedName = available.collaborators.find((row) => row.id === selectedId)?.name || 'Todos os colaboradores';
  const value = (amount) => loading || error ? '—' : money.format(amount);
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
        <header><div><h2>Evolução Mensal Staff</h2><small>{selectedName} · {period.year} · Por data do serviço</small></div></header>
        <div className="balance-staff-annual" aria-label="Totais anuais de Staff">
          <div><span>Custo anual</span><strong>{value(analysis.annualTotals.cost)}</strong></div>
          <div><span>Serviços no ano</span><strong>{loading || error ? '—' : analysis.annualTotals.services}</strong></div>
          <div><span>Horas no ano</span><strong>{loading || error ? '—' : durationHours(analysis.annualTotals.hours)}</strong></div>
        </div>
        {!loading && !error ? (
          <>
            <div className="balance-chart-legend"><span><i className="legend-revenue" />Custo total</span><span><i className="legend-client-margin" />Já pago</span></div>
            <div className="balance-staff-chart">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={analysis.monthlySeries} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                  <XAxis dataKey="month" stroke="#8da0aa" tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis width={65} stroke="#8da0aa" tickLine={false} axisLine={false} tickFormatter={(amount) => amount >= 1000 ? `${amount / 1000}k €` : money.format(amount)} />
                  <Tooltip contentStyle={{ background: '#11181c', border: '1px solid #26343a', borderRadius: 6 }} formatter={(amount, name) => [money.format(Number(amount)), name]} />
                  <Bar dataKey="cost" name="Custo total" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Line dataKey="paid" name="Já pago" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details className="balance-staff-months"><summary>Detalhe mensal · {period.year}</summary>
              <table className="balance-staff-table"><thead><tr><th>Mês</th><th>Serviços</th><th>Horas</th><th>Custo total</th><th>Já pago</th><th>Por pagar</th></tr></thead><tbody>
                {analysis.monthlySeries.map((row) => <tr key={row.month}>
                  <td data-label="Mês">{row.month}</td><td data-label="Serviços">{row.services}</td><td data-label="Horas">{durationHours(row.hours)}</td><td data-label="Custo total">{money.format(row.cost)}</td><td data-label="Já pago">{money.format(row.paid)}</td><td data-label="Por pagar">{money.format(row.unpaid)}</td>
                </tr>)}
              </tbody></table>
            </details>
          </>
        ) : null}
      </section>
    </div>
  );
}
