import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/UI/Card.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { asNumber, money } from '../utils/formatters.js';

const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const activeServiceStatuses = ['drafting', 'partial', 'team_complete', 'pending', 'confirmed', 'in_progress', 'ongoing', 'to_validate', 'to_validate_staff', 'to_validate_client'];

function serviceStatusLabel(status) {
  if (status === 'drafting') return 'A preencher';
  if (status === 'partial') return 'Parcialmente preenchido';
  if (status === 'team_complete') return 'Equipa completa';
  if (status === 'pending') return 'Pendente';
  if (status === 'confirmed') return 'Confirmado';
  if (status === 'in_progress') return 'Em execução';
  if (status === 'ongoing') return 'Em curso';
  if (status === 'completed') return 'Concluído';
  if (status === 'to_validate') return 'Por validar';
  if (status === 'to_validate_staff') return 'Por validar horários (Staff)';
  if (status === 'to_validate_client') return 'Por validar horários (Cliente)';
  if (status === 'invoiced') return 'Faturado';
  if (status === 'paid') return 'Pago';
  if (status === 'cancelled') return 'Cancelado';
  return status || '-';
}

export default function Dashboard() {
  const { data: services, loading: loadingServices, error: servicesError } = useApi('/services', []);
  const { data: collaborators, loading: loadingCollaborators, error: collaboratorsError } = useApi('/collaborators', []);
  const { data: invoices, loading: loadingInvoices, error: invoicesError } = useApi('/invoices', []);
  const { data: transactions, loading: loadingTransactions } = useApi('/transactions', []);

  const revenue = services.reduce((sum, service) => sum + asNumber(service.totalRevenue), 0);
  const serviceExpense = services.reduce((sum, service) => sum + asNumber(service.totalCost), 0);
  const transactionExpense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + asNumber(tx.amount), 0);
  const expense = Math.max(serviceExpense, transactionExpense);
  const activeServices = services.filter((service) => activeServiceStatuses.includes(service.status)).length;
  const activeCollaborators = collaborators.filter((c) => c.status === 'active').length;
  const receivable = useMemo(() => {
    const totalPaidInvoices = invoices
      .filter((invoice) => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + asNumber(invoice.total), 0);
    return Math.max(0, revenue - totalPaidInvoices);
  }, [invoices, revenue]);
  const pendingInvoices = invoices.filter((invoice) => ['draft', 'issued'].includes(invoice.status)).length;

  const monthlyRevenue = monthNames.map((month, index) => {
    const total = services
      .filter((service) => {
        const source = service.date || service.createdAt;
        if (!source) return false;
        return new Date(source).getMonth() === index;
      })
      .reduce((sum, service) => sum + asNumber(service.totalRevenue), 0);
    return { month, receita: total };
  });

  const upcomingServices = [...services]
    .filter((service) => service.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);
  const loading = loadingServices || loadingCollaborators || loadingInvoices || loadingTransactions;
  const error = servicesError || collaboratorsError || invoicesError;

  return (
    <div className="page">
      {error ? <p className="notice">{error}</p> : null}
      <Stats
        items={[
          { label: 'Valor total dos eventos', value: money.format(revenue), detail: 'Total cobrado ao cliente' },
          { label: 'Despesas totais', value: money.format(expense), detail: 'Pagamentos a colaboradores' },
          { label: 'Margem', value: money.format(revenue - expense), detail: 'Receita - despesa' },
          { label: 'Por receber', value: money.format(receivable), detail: `${pendingInvoices} faturas pendentes` },
          { label: 'Serviços ativos', value: activeServices, detail: 'Em preparação ou execução' },
          { label: 'Colaboradores ativos', value: activeCollaborators, detail: `${collaborators.length} registados` },
        ]}
      />

      <div className="grid grid--two">
        <Card title="Receita mensal">
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
                  <span>{service.client?.name || 'Cliente por associar'}</span>
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

