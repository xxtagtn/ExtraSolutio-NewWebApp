import { FilePlus2, ReceiptText } from 'lucide-react';
import { useMemo, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date, money } from '../utils/formatters.js';

const BILLING_METHOD_LABELS = {
  prepaid: 'Pre-pagamento',
  per_event: 'Por evento',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  custom: 'Personalizado',
};

const STATUS_LABELS = {
  draft: 'Rascunho',
  issued: 'Emitida',
  paid: 'Paga',
  cancelled: 'Anulada',
};

const CLOSED_BILLING_STATUSES = new Set(['partial70', 'invoiced', 'paid']);
const FINANCE_READY_EVENT_STATUSES = new Set(['to_validate_client', 'paid']);

function isFinanceReadyEvent(event) {
  const operationalStatus = String(event?.status || '').trim().toLowerCase();
  const billingStatus = String(event?.billingStatus || '').trim().toLowerCase();
  return FINANCE_READY_EVENT_STATUSES.has(operationalStatus) || CLOSED_BILLING_STATUSES.has(billingStatus);
}

function num(value) {
  return Number(value || 0);
}

function parseInvoiceEventIds(invoice) {
  if (invoice.eventIds) {
    try {
      return JSON.parse(invoice.eventIds).map(Number);
    } catch {
      return [];
    }
  }
  return invoice.eventId ? [Number(invoice.eventId)] : [];
}

function eventHasInvoice(eventId, invoices) {
  return invoices.some((invoice) => parseInvoiceEventIds(invoice).includes(Number(eventId)));
}

function startOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(value, days) {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function termDays(client) {
  if (client.paymentTerm === 'immediate') return 0;
  if (client.paymentTerm === 'days_15') return 15;
  if (client.paymentTerm === 'days_30') return 30;
  if (client.paymentTerm === 'days_45') return 45;
  if (client.paymentTerm === 'custom') return Number(client.paymentTermDays || 0);
  return 30;
}

function dueDateForGroup(group) {
  if (group.method === 'prepaid') {
    const eventDate = startOfDay(group.events[0].date);
    const today = startOfDay(new Date());
    return eventDate < today ? today : eventDate;
  }
  return addDays(group.issueDate, termDays(group.client));
}

function monthName(value) {
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(value);
}

function groupKeyForEvent(event) {
  const client = event.client || {};
  const method = client.billingMethod || 'per_event';
  const d = new Date(event.date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  if (method === 'monthly') {
    return {
      key: `${client.id}:monthly:${year}-${month}`,
      label: `${client.name} · ${monthName(d)}`,
      issueDate: lastDayOfMonth(year, month),
    };
  }

  if (method === 'biweekly') {
    const half = day <= 15 ? 1 : 2;
    return {
      key: `${client.id}:biweekly:${year}-${month}:${half}`,
      label: `${client.name} · ${half === 1 ? '1a quinzena' : '2a quinzena'} ${monthName(d)}`,
      issueDate: half === 1 ? new Date(year, month, 15) : lastDayOfMonth(year, month),
    };
  }

  if (method === 'custom') {
    return {
      key: `${client.id}:custom:${year}-${month}`,
      label: `${client.name} · ${client.billingCustomRule || monthName(d)}`,
      issueDate: lastDayOfMonth(year, month),
    };
  }

  return {
    key: `${client.id}:${method}:${event.id}`,
    label: `${client.name || 'Cliente'} · ${event.name}`,
    issueDate: method === 'prepaid' ? new Date() : addDays(d, 1),
  };
}

function buildBillingGroups(events, invoices) {
  const groups = new Map();
  for (const event of events) {
    if (!isFinanceReadyEvent(event)) continue;
    const total = num(event.totalRevenue);
    if (!event.clientId || !event.client?.id || !event.date || total <= 0) continue;
    if (eventHasInvoice(event.id, invoices)) continue;
    if (CLOSED_BILLING_STATUSES.has(String(event.billingStatus || ''))) continue;

    const client = event.client || {};
    const method = client.billingMethod || 'per_event';
    const info = groupKeyForEvent(event);
    const current = groups.get(info.key) || {
      key: info.key,
      client,
      method,
      label: info.label,
      issueDate: info.issueDate,
      events: [],
      total: 0,
    };
    current.events.push(event);
    current.total += total;
    groups.set(info.key, current);
  }
  return [...groups.values()].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
}

function invoiceNumber(group) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const suffix = String(Date.now()).slice(-6);
  return `ES-${yyyy}${mm}-${group.client.id || '0'}-${suffix}`;
}

export default function Invoices() {
  const { data: invoices, loading, error, reload } = useApi('/invoices', []);
  const { data: services, reload: reloadServices } = useApi('/services', []);
  const [generatingKey, setGeneratingKey] = useState('');
  const [message, setMessage] = useState('');
  const [today] = useState(() => new Date());

  const groups = useMemo(() => buildBillingGroups(services, invoices), [services, invoices]);

  const totals = useMemo(() => {
    const pending = groups.reduce((sum, group) => sum + group.total, 0);
    const receivable30 = invoices
      .filter((invoice) => invoice.status !== 'paid' && invoice.dueDate)
      .filter((invoice) => {
        const days = (new Date(invoice.dueDate).getTime() - today.getTime()) / 86_400_000;
        return days >= 0 && days <= 30;
      })
      .reduce((sum, invoice) => sum + num(invoice.total), 0);
    return {
      pending,
      groups: groups.length,
      receivable30,
      issued: invoices.filter((invoice) => invoice.status !== 'draft' && invoice.status !== 'cancelled').reduce((sum, invoice) => sum + num(invoice.total), 0),
    };
  }, [groups, invoices, today]);

  async function generateInvoice(group) {
    setGeneratingKey(group.key);
    setMessage('');
    try {
      const total = Number(group.total.toFixed(2));
      const taxRate = 23;
      const subtotal = Number((total / (1 + (taxRate / 100))).toFixed(2));
      const taxAmount = Number((total - subtotal).toFixed(2));
      const dueDate = dueDateForGroup(group);
      const firstEvent = group.events[0];
      await api('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          number: invoiceNumber(group),
          clientId: Number(group.client.id),
          eventId: group.events.length === 1 ? Number(firstEvent.id) : null,
          eventIds: JSON.stringify(group.events.map((event) => event.id)),
          billingPeriodLabel: group.label,
          issueDate: new Date().toISOString(),
          dueDate: dueDate.toISOString(),
          subtotal,
          taxRate,
          taxAmount,
          total,
          status: 'issued',
          notes: `${BILLING_METHOD_LABELS[group.method] || group.method} · ${group.events.length} evento(s)`,
        }),
      });
      await Promise.all(group.events.map((event) => api(`/services/${event.id}`, {
        method: 'PUT',
        body: JSON.stringify({ billingStatus: 'invoiced' }),
      })));
      setMessage(`Fatura gerada para ${group.label}.`);
      reload();
      reloadServices();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setGeneratingKey('');
    }
  }

  return (
    <div className="page billing-page">
      <div className="page-title-row">
        <div>
          <h1>Faturação</h1>
          <p>Eventos agrupados por regra de faturacao do cliente, separados da operacao.</p>
        </div>
      </div>

      <Stats
        items={[
          { label: 'Pronto / pendente faturar', value: money.format(totals.pending) },
          { label: 'Grupos por faturar', value: String(totals.groups) },
          { label: 'A receber nos proximos 30 dias', value: money.format(totals.receivable30) },
          { label: 'Faturação emitida', value: money.format(totals.issued) },
        ]}
      />

      <Card title="Por Faturar">
        {error ? <p className="notice">{error}</p> : null}
        {message ? <p className="notice">{message}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}
        <div className="billing-group-list">
          {groups.map((group) => {
            const isPrepaid = group.method === 'prepaid';
            const hasMissingPayment = isPrepaid && group.events.some((event) => event.billingStatus !== 'paid');
            return (
              <article key={group.key} className="billing-group-card">
                <div>
                  <small>{BILLING_METHOD_LABELS[group.method] || group.method}</small>
                  <strong>{group.label}</strong>
                  <span>{group.events.length} evento(s) · Emissao prevista: {date.format(group.issueDate)}</span>
                </div>
                <div className="billing-group-events">
                  {group.events.slice(0, 4).map((event) => (
                    <span key={event.id}>{event.date ? date.format(new Date(event.date)) : '-'} · {event.name}</span>
                  ))}
                  {group.events.length > 4 ? <span>+ {group.events.length - 4} evento(s)</span> : null}
                </div>
                <div className="billing-group-side">
                  {hasMissingPayment ? <Badge tone="neutral">Pagamento em falta</Badge> : <Badge tone="info">Pronto faturar</Badge>}
                  <strong>{money.format(group.total)}</strong>
                  <button className="command-button" type="button" onClick={() => generateInvoice(group)} disabled={generatingKey === group.key}>
                    <FilePlus2 size={16} />
                    {generatingKey === group.key ? 'A gerar...' : 'Gerar fatura'}
                  </button>
                </div>
              </article>
            );
          })}
          {!loading && !groups.length ? <p className="muted">Sem eventos pendentes de faturação.</p> : null}
        </div>
      </Card>

      <Card title="Faturas Emitidas">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Periodo / Evento</th>
                <th>Emissao</th>
                <th>Vencimento</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td><ReceiptText size={14} /> {invoice.number}</td>
                  <td>{invoice.client?.name || '-'}</td>
                  <td>{invoice.billingPeriodLabel || invoice.event?.name || '-'}</td>
                  <td>{invoice.issueDate ? date.format(new Date(invoice.issueDate)) : '-'}</td>
                  <td>{invoice.dueDate ? date.format(new Date(invoice.dueDate)) : '-'}</td>
                  <td>{money.format(num(invoice.total))}</td>
                  <td><Badge tone={invoice.status === 'paid' ? 'success' : 'info'}>{STATUS_LABELS[invoice.status] || invoice.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
