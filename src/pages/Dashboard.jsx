import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo, useState } from 'react';
import { Activity, CalendarCheck2, CircleDollarSign, ReceiptText, TrendingUp, UsersRound, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../components/UI/Card.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import {
  availableFinancialYears,
  countRealizedServices,
  filterByFinancialPeriod,
  monthlyRevenueSeries,
} from '../utils/dashboardMetrics.js';
import { asNumber, money } from '../utils/formatters.js';
import { SERVICE_STATUS, statusLabel } from '../utils/serviceStatus.js';

const monthOptions = [
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
const activeServiceStatuses = [
  SERVICE_STATUS.drafting,
  'partial',
  SERVICE_STATUS.teamComplete,
  'pending',
  'confirmed',
  SERVICE_STATUS.inProgress,
  'ongoing',
  'to_validate',
  SERVICE_STATUS.toValidateStaff,
  SERVICE_STATUS.toValidateClient,
];

const serviceStatusLabel = statusLabel;

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function serviceEndDate(service) {
  return service?.isContinuous && service.endDate ? service.endDate : service?.date;
}

function formatServiceDateRange(service) {
  if (!service?.date) return '-';
  const start = new Date(service.date).toLocaleDateString('pt-PT');
  const endValue = serviceEndDate(service);
  if (!service.isContinuous || !endValue || dateOnly(endValue) === dateOnly(service.date)) return start;
  return `${start} - ${new Date(endValue).toLocaleDateString('pt-PT')}`;
}

function selectedPeriodLabel(month, year) {
  const monthLabel = monthOptions.find(([value]) => value === month)?.[1];
  if (monthLabel && year) return `${monthLabel} de ${year}`;
  if (monthLabel) return `${monthLabel} de todos os anos`;
  if (year) return `Ano ${year}`;
  return 'Resultados gerais';
}

export default function Dashboard() {
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: collaborators, loading: loadingCollaborators, error: collaboratorsError } = useApi('/collaborators?light=1', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const { data: transactions, loading: loadingTransactions } = useApi('/transactions', []);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const period = useMemo(
    () => ({ month: selectedMonth, year: selectedYear }),
    [selectedMonth, selectedYear],
  );
  const yearOptions = useMemo(
    () => availableFinancialYears(services, invoices, transactions),
    [invoices, services, transactions],
  );
  const filteredServices = useMemo(
    () => filterByFinancialPeriod(services, period),
    [period, services],
  );
  const filteredInvoices = useMemo(
    () => filterByFinancialPeriod(invoices, period, (invoice) => invoice.issueDate || invoice.createdAt),
    [invoices, period],
  );
  const filteredTransactions = useMemo(
    () => filterByFinancialPeriod(transactions, period),
    [period, transactions],
  );

  const revenue = filteredServices.reduce((sum, service) => sum + asNumber(service.totalRevenue), 0);
  const serviceExpense = filteredServices.reduce((sum, service) => sum + asNumber(service.totalCost), 0);
  const transactionExpense = filteredTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + asNumber(tx.amount), 0);
  const expense = Math.max(serviceExpense, transactionExpense);
  const activeServices = filteredServices.filter((service) => activeServiceStatuses.includes(service.status)).length;
  const activeCollaborators = collaborators.filter((collaborator) => collaborator.status === 'active').length;
  const receivable = useMemo(() => {
    const totalPaidInvoices = filteredInvoices
      .filter((invoice) => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + asNumber(invoice.total), 0);
    return Math.max(0, revenue - totalPaidInvoices);
  }, [filteredInvoices, revenue]);
  const pendingInvoices = filteredInvoices.filter((invoice) => ['draft', 'issued'].includes(invoice.status)).length;
  const monthlyRevenue = useMemo(
    () => monthlyRevenueSeries(services, period),
    [period, services],
  );

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const realizedServices = countRealizedServices(filteredServices, todayStart);
  const upcomingServices = [...filteredServices]
    .filter((service) => service.date && new Date(serviceEndDate(service) || service.date) >= todayStart)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);
  const loading = loadingServices || loadingCollaborators || loadingInvoices || loadingTransactions;
  const error = servicesError || collaboratorsError || invoicesError;

  return (
    <div className="page dashboard-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Gestão</span>
          <h1>Balancete</h1>
          <p>{selectedPeriodLabel(selectedMonth, selectedYear)}</p>
        </div>
        <div className="balance-period-control" aria-label="Filtros do Balancete">
          <label>
            Mês
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <option value="">Todos os meses</option>
              {monthOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Ano
            <input
              type="number"
              min="2000"
              max="2100"
              inputMode="numeric"
              list="balance-year-options"
              placeholder="Todos os anos"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
            />
            <datalist id="balance-year-options">
              {yearOptions.map((year) => <option key={year} value={year} />)}
            </datalist>
          </label>
          {(selectedMonth || selectedYear) ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setSelectedMonth('');
                setSelectedYear('');
              }}
            >
              Limpar
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="notice">{error}</p> : null}
      <Stats
        className="dashboard-stats"
        items={[
          {
            label: 'Valor total dos eventos',
            value: money.format(revenue),
            detail: 'Total cobrado ao cliente',
            icon: <CircleDollarSign size={19} />,
            tone: 'accent',
            featured: true,
          },
          {
            label: 'Despesas totais',
            value: money.format(expense),
            detail: 'Pagamentos a colaboradores',
            icon: <ReceiptText size={18} />,
            tone: 'warning',
          },
          {
            label: 'Margem',
            value: money.format(revenue - expense),
            detail: 'Receita - despesa',
            icon: <TrendingUp size={18} />,
            tone: revenue - expense < 0 ? 'danger' : 'success',
          },
          {
            label: 'Por receber',
            value: money.format(receivable),
            detail: `${pendingInvoices} faturas pendentes`,
            icon: <WalletCards size={18} />,
            tone: receivable > 0 ? 'info' : 'success',
          },
          {
            label: 'Serviços ativos',
            value: activeServices,
            detail: 'Em preparação ou execução',
            icon: <Activity size={18} />,
            tone: 'info',
          },
          {
            label: 'Eventos Realizados',
            value: realizedServices,
            detail: 'Finalizados ou com data passada',
            icon: <CalendarCheck2 size={18} />,
            tone: 'neutral',
          },
          {
            label: 'Nº Colaboradores (Ativos)',
            value: activeCollaborators,
            detail: `${collaborators.length} registados · estado atual`,
            icon: <UsersRound size={18} />,
            tone: 'accent',
          },
        ]}
      />

      <div className="grid grid--two">
        <Card title={selectedMonth ? 'Receita do período' : 'Receita mensal'}>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={monthlyRevenue}>
                <defs>
                  <linearGradient id="revenue" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#243034" strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="#7c8a92" />
                <YAxis stroke="#7c8a92" />
                <Tooltip
                  contentStyle={{ background: '#11181c', border: '1px solid #26343a' }}
                  formatter={(value) => [money.format(Number(value || 0)), 'Receita']}
                />
                <Area type="monotone" dataKey="receita" stroke="#14b8a6" fill="url(#revenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Próximos serviços">
          <div className="stack-list">
            {upcomingServices.map((service) => (
              <Link className="stack-row" key={service.id} to={`/services?serviceId=${service.id}`}>
                <div>
                  <strong>{service.name}</strong>
                  <span>
                    {service.client?.name || 'Cliente por associar'} · {formatServiceDateRange(service)}
                  </span>
                </div>
                <small>{serviceStatusLabel(service.status)}</small>
              </Link>
            ))}
            {loading ? <p className="muted">A carregar...</p> : null}
            {!loading && upcomingServices.length === 0 && <p className="muted">Ainda não há serviços registados.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
