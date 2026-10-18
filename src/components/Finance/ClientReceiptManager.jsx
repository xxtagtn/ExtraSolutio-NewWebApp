import { useRef, useState } from 'react';
import { Plus, ReceiptText, Trash2, RotateCcw, Edit3, CheckCircle2, CalendarDays, Save, Archive, Split } from 'lucide-react';
import Modal from '../UI/Modal.jsx';
import Badge from '../UI/Badge.jsx';
import ClientPaymentTax from '../UI/ClientPaymentTax.jsx';
import ClientPaymentAdjustment from '../UI/ClientPaymentAdjustment.jsx';
import ClientReceiptEditor from './ClientReceiptEditor.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { api } from '../../utils/api.js';
import { hasPermission, PERMISSIONS } from '../../utils/accessPermissions.js';
import { clientFinancialState } from '../../utils/clientFinancialState.js';
import { shouldShowClientPaymentAlert } from '../../utils/clientPaymentAlert.js';
import { buildClientFinanceSnapshot } from '../../utils/clientFinanceSnapshot.js';
import ClientBillingPeriods from './ClientBillingPeriods.jsx';
import { clientReceiptInvoiceBlocker, clientReceiptRegistrationBlocker } from '../../utils/clientPayment.js';
import { clientPaymentAdjustment, paymentFinancialSnapshot } from '../../utils/clientPaymentAdjustment.js';
import { clientReceiptTaxSummary } from '../../utils/clientReceiptTax.js';
import { readClientPaymentRecord } from '../../utils/clientPaymentRecord.js';
import { receiptCanDelete, receiptMovements, receiptTypeLabels } from '../../utils/clientReceiptMovements.js';
import { statusLabel } from '../../utils/serviceStatus.js';
import { money, date } from '../../utils/formatters.js';
import { clientPaymentTermDays, dueDateFromInvoiceIssue, invoiceIsIssued, invoiceIsPaid } from '../../../shared/invoiceLifecycle.js';
import { billingToday } from '../../../shared/clientBillingCalendar.js';

const dayLabel = (value) => value ? date.format(new Date(value)) : 'Data não registada';

export default function ClientReceiptManager({ event: initialEvent, invoices, onChanged, onInvoiceStatusChange, onClose }) {
  const { data, loading, error, reload } = useApi(`/services/${initialEvent.id}`, initialEvent, { revalidateOnFocus: true });
  const event = { ...initialEvent, ...data, invoices: data?.invoices || invoices || [] };
  const state = clientFinancialState(event), record = readClientPaymentRecord(event.clientPaymentRecord);
  const finance = event.clientFinance || buildClientFinanceSnapshot(event);
  const projection = receiptMovements(record);
  const rows = record ? projection.reliable ? projection.rows : [] : [
    ...(state.signal > 0 ? [{ id: 'legacy-signal', type: 'signal', amount: Math.min(state.signal, state.received), receivedAt: event.signaledAt }] : []),
    ...(state.remainingReceived > 0 ? [{ id: 'legacy-remaining', type: 'remaining', amount: state.remainingReceived, receivedAt: event.billingPaymentDate }] : []),
  ];
  const { user } = useAuth();
  const canWrite = hasPermission(user, PERMISSIONS.SERVICES_UPDATE) && hasPermission(user, PERMISSIONS.FINANCE_UPDATE_PAYMENTS);
  const canUpdateInvoices = hasPermission(user, PERMISSIONS.FINANCE_ISSUE_INVOICES) && hasPermission(user, PERMISSIONS.SERVICES_UPDATE);
  const blocker = clientReceiptInvoiceBlocker(event);
  const registrationBlocker = clientReceiptRegistrationBlocker(event);
  const [action, setAction] = useState(null);
  const commercial = record?.commercialStatus === 'invoiced' || (blocker && state.status === 'invoiced') ? 'invoiced' : 'automatic';
  const [issueDraft, setIssueDraft] = useState(null);
  const [paidDraft, setPaidDraft] = useState(null);
  const [allocationDraft, setAllocationDraft] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState('');
  const pending = useRef(false);
  const tax = clientReceiptTaxSummary(event, state.received);
  const adjustment = clientPaymentAdjustment(event, state.received);
  const fiscalPaid = state.invoiceSettled ? paymentFinancialSnapshot(event) : tax.received;
  const billingMethod = { prepaid: 'Pré-pagamento', per_event: 'Por evento', monthly: 'Mensal', biweekly: 'Quinzenal', custom: 'Personalizado' }[event.client?.billingMethod] || 'Por configurar';
  const termDays = clientPaymentTermDays(event.client);
  const paymentTerm = termDays == null ? 'Por configurar' : termDays === 0 ? 'Imediato' : `${termDays} dias`;
  const calendarReference = ['monthly', 'biweekly', 'per_event'].includes(event.client?.billingMethod) ? finance.periods[0]?.referenceDate : null;
  const previewDueDate = issueDraft?.issueDate ? dueDateFromInvoiceIssue(issueDraft.issueDate, event.client) : null;
  const audit = [...(record?.entries || []), ...(record?.commercialChanges || []).map((entry, index) => ({ ...entry, id: `commercial-${index}`, commercial: true })),
    ...(record?.financeChanges || []).map((entry, index) => ({ ...entry, id: `finance-${index}`, finance: true }))]
    .sort((a, b) => (new Date(a.recordedAt || a.receivedAt || 0).getTime() || 0) - (new Date(b.recordedAt || b.receivedAt || 0).getTime() || 0));

  async function mutate(path, body) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setSaveError('');
    try {
      const result = await api(`/services/${event.id}/client-payment/${path}`, { method: 'POST', body: JSON.stringify(body) });
      await reload({ background: true });
      await onChanged();
      window.dispatchEvent(new window.Event('extrasolutio:client-payment-changed'));
      setAction(null);
      return result;
    } finally { pending.current = false; setBusy(false); }
  }

  function openAction(movement, kind) {
    setAction({ movement, kind, updatedAt: event.updatedAt, revision: record?.entries.length || 0 });
  }

  function openReceipt(settle = false) {
    openAction({ id: 'new', type: settle ? 'remaining' : state.received ? 'adjustment' : 'signal', amount: state.outstanding,
      receivedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }, 'create');
  }

  async function saveInvoiceStatus(invoice, status) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setSaveError('');
    try { await onInvoiceStatusChange(invoice, status); await reload({ background: true }); }
    catch (err) { setSaveError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }

  async function submitReceipt(input) {
    const body = { ...input, updatedAt: action.updatedAt, revision: action.revision };
    if (action.kind === 'create') return mutate('receive', body);
    return mutate(`movements/${encodeURIComponent(action.movement.id)}`, { ...body, confirmedAmount: action.movement.amount });
  }

  async function saveCommercial(status, issueDate) {
    setSavedMessage('');
    try {
      await mutate('commercial-status', { updatedAt: event.updatedAt, revision: record?.commercialChanges?.length || 0, status, issueDate });
      setIssueDraft(null);
      setSavedMessage('Estado financeiro guardado.');
    }
    catch (err) { setSaveError(err.message); }
  }

  async function confirmInvoicePaid(e) {
    e.preventDefault();
    if (pending.current) return;
    try {
      const result = await mutate('invoice-paid', { updatedAt: paidDraft.updatedAt, revision: paidDraft.revision,
        confirmedTotal: paidDraft.total, confirmedReceived: paidDraft.received, amount: paidDraft.amount,
        receivedAt: paidDraft.receivedAt, issueDate: paidDraft.issueDate });
      setPaidDraft(null);
      setSavedMessage(result?.clientFinance?.archive.archived ? 'Fatura paga. Serviço arquivado.'
        : 'Fatura paga. O arquivo fica disponível quando o serviço estiver operacionalmente concluído.');
    } catch (err) { setSaveError(err.message); }
  }

  async function saveFinancialMetadata(body) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setSaveError('');
    try {
      await api(`/services/${event.id}/client-finance`, { method: 'POST', body: JSON.stringify({ ...body, updatedAt: event.updatedAt,
        revision: record?.entries.length || 0 }) });
      await reload({ background: true }); await onChanged(); setAllocationDraft(null);
    } catch (error) { setSaveError(error.message); }
    finally { pending.current = false; setBusy(false); }
  }

  if (action) return <ClientReceiptEditor key={`${action.kind}-${action.movement.id}`} event={event} movement={action.movement}
    action={action.kind} saving={busy} onSubmit={submitReceipt} onClose={() => { if (!busy) setAction(null); }} />;

  return <Modal title="Gerir recebimentos" size="wide" preventFocusScroll onClose={() => { if (!busy) onClose(); }}>
    <div className="finance-receipt-manager">
      <header className="finance-receipt-manager-heading"><div><h3>{event.name}</h3><small>{event.client?.name || event.clientName} · {dayLabel(event.date)}</small></div>
        <Badge tone={finance.overdue ? 'danger' : finance.paymentStatus === 'paid' ? 'success' : 'warning'}>{finance.paymentLabel}</Badge></header>
      {loading ? <p className="muted" role="status">A atualizar recebimentos...</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <dl className="payment-overview-totals">
        <div data-payment-metric="total"><dt>Total do evento</dt><ClientPaymentTax value={tax.total} total={state.total} /></div>
        <div data-payment-metric="received"><dt>Recebido</dt><ClientPaymentTax value={fiscalPaid} total={state.received} /></div>
        <div data-payment-metric="outstanding"><dt>Por receber</dt><ClientPaymentTax value={tax.outstanding} total={state.outstanding} /></div>
      </dl>
      {shouldShowClientPaymentAlert(event, { payment: state }) ? <p className={`finance-receipt-balance${finance.overdue ? ' client-finance-overdue' : ''}`}><ReceiptText size={16} />{finance.overdue && !finance.afterAdjustment ? 'Fatura vencida' : 'Pagamento em falta'} <strong>{money.format(state.outstanding)}</strong></p> : null}
      <ClientBillingPeriods finance={finance} />
      {canWrite && finance.periods.length > 1 ? <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => {
        const saved = record?.billingAllocation;
        setAllocationDraft(finance.periods.map((period) => {
          const row = saved?.periods?.find((item) => item.key === period.key);
          return { key: period.key, globalTotal: String(row?.globalTotal ?? 0), globalTax: String(row?.globalTax ?? 0), received: String(row?.received ?? 0) };
        }));
      }}><Split size={15} />Repartir faturação</button> : null}
      {allocationDraft ? <form className="client-billing-allocation" onSubmit={(e) => {
        e.preventDefault(); saveFinancialMetadata({ action: 'allocate', periods: allocationDraft.map((row) => ({ ...row,
          globalTotal: Number(row.globalTotal.replace(',', '.')), globalTax: Number(row.globalTax.replace(',', '.')), received: Number(row.received.replace(',', '.')) })) });
      }}>
        <dl className="finance-receipt-dates"><div><dt>Valores globais por repartir · com IVA</dt><dd>{money.format(finance.unassignedTotal)}</dd></div>
          <div><dt>IVA incluído por repartir</dt><dd>{money.format(finance.unassignedTax)}</dd></div><div><dt>Total recebido a distribuir</dt><dd>{money.format(finance.payment.received)}</dd></div></dl>
        {allocationDraft.map((row, index) => <fieldset key={row.key}><legend>{dayLabel(finance.periods[index].start)} - {dayLabel(finance.periods[index].end)}</legend>
          <small>Staff deste período: {money.format(finance.periods[index].staffBase + finance.periods[index].staffTax)}</small>
          <div className="service-detail-payment-grid">{[['globalTotal', 'Valor global com IVA'], ['globalTax', 'IVA incluído'], ['received', 'Recebido neste período']].map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" aria-label={`${label} ${index + 1}`} value={row[field]} disabled={busy}
            onChange={(e) => setAllocationDraft((rows) => rows.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item))} /></label>)}</div>
        </fieldset>)}
        <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAllocationDraft(null)}>Cancelar</button>
          <button type="submit" className="command-button" disabled={busy}><Save size={15} />Guardar repartição</button></div>
      </form> : null}
      {adjustment ? <section className="finance-receipt-adjustment"><h4>Ajuste após validação</h4><ClientPaymentAdjustment breakdown={adjustment} /></section> : null}
      {Number(event.billingAdjustment) !== 0 && event.billingAdjustment != null ? <p>Ajuste de faturação: <strong>{money.format(Number(event.billingAdjustment))}</strong></p> : null}
      <div className="finance-receipt-context"><span>Estado operacional: <strong>{statusLabel(event.status)}</strong></span>
        <span>Faturação: <strong>{billingMethod}</strong></span>
        <span>Pagamento: <strong>{paymentTerm}</strong></span></div>
      {canWrite && !registrationBlocker && state.outstanding > 0 ? <section className="finance-receipt-settlement">
        <div><small>Saldo por liquidar</small><strong>{money.format(state.outstanding)}</strong></div>
        <button type="button" className="command-button" disabled={busy || loading || Boolean(error)} onClick={() => openReceipt(true)}><CheckCircle2 size={16} />Liquidar saldo</button>
      </section> : null}
      {canWrite && finance.archive.needsConfirmation ? <button className="command-button" type="button" disabled={busy || loading} onClick={() => {
        if (window.confirm('Arquivar este serviço? O histórico será mantido.')) saveFinancialMetadata({ action: 'archive', confirmedTotal: finance.payment.total, confirmedReceived: finance.payment.received });
      }}><Archive size={15} />Arquivar serviço</button> : null}
      {canWrite && finance.archive.archived ? <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => {
        if (window.confirm('Restaurar este serviço à lista ativa?')) saveFinancialMetadata({ action: 'restore' });
      }}><RotateCcw size={15} />Restaurar serviço</button> : null}
      <div className="finance-receipt-commercial service-detail-payment-grid">
        <label>Estado financeiro<select aria-label="Estado financeiro" value={paidDraft ? 'paid' : issueDraft ? 'invoiced'
          : state.outstanding === 0 && (state.invoiceSettled || finance.archive.archived || record?.financeChanges?.some((entry) => entry.action === 'invoice_paid')) ? 'paid' : commercial} onChange={(e) => {
          setSaveError(''); setSavedMessage(''); setPaidDraft(null);
          if (e.target.value === 'paid') {
            setIssueDraft(null);
            setPaidDraft({ updatedAt: event.updatedAt, revision: record?.entries.length || 0, total: state.total, received: state.received,
              amount: state.outstanding, receivedAt: billingToday(), issueDate: calendarReference || record?.commercialIssueDate || '' });
          } else if (e.target.value === 'invoiced') { setIssueDraft({ issueDate: calendarReference || record?.commercialIssueDate || '' }); }
          else { setIssueDraft(null); if (commercial !== 'automatic') saveCommercial('automatic'); }
        }} disabled={!canWrite || busy || loading || Boolean(error)}>
          <option value="automatic" disabled={Boolean(blocker)}>Automático</option><option value="invoiced" disabled={Boolean(blocker)}>Faturado</option>
          <option value="paid" disabled={state.total <= 0 || (event.invoices.some(invoiceIsIssued) && !canUpdateInvoices)}>Fatura paga</option>
        </select></label>
        {!issueDraft && canWrite && !registrationBlocker && (commercial === 'invoiced' || record?.legacyInvoiced) ? <button type="button" className="secondary-button" disabled={busy || loading || Boolean(error)}
          onClick={() => { setSaveError(''); setSavedMessage(''); setIssueDraft({ issueDate: calendarReference || record?.commercialIssueDate || '' }); }}>
          <CalendarDays size={15} />{record?.commercialIssueDate ? 'Editar emissão' : 'Registar emissão'}</button> : null}
        {busy ? <p className="muted" role="status">A guardar...</p> : savedMessage ? <p role="status">{savedMessage}</p> : null}
      </div>
      {paidDraft ? <form className="finance-receipt-paid-form" onSubmit={confirmInvoicePaid}>
        <h4>Confirmar fatura paga</h4>
        <div className="service-detail-payment-grid">
          <label>Valor a receber<input value={money.format(paidDraft.amount)} readOnly /></label>
          <label>Data efetiva do recebimento<input type="date" required value={paidDraft.receivedAt} disabled={busy}
            onChange={(e) => setPaidDraft({ ...paidDraft, receivedAt: e.target.value })} /></label>
          {!calendarReference && !record?.commercialIssueDate && !event.invoices.some(invoiceIsIssued) ? <label>Data de faturação<input type="date" required value={paidDraft.issueDate} disabled={busy}
            onChange={(e) => setPaidDraft({ ...paidDraft, issueDate: e.target.value })} /></label> : null}
        </div>
        <p>{paidDraft.amount > 0 ? `Confirmas o recebimento de ${money.format(paidDraft.amount)}?` : 'O valor total já se encontra recebido.'}
          {' '}{finance.completed ? 'O serviço será arquivado após a confirmação da liquidação integral.' : 'O pagamento não conclui a operação. O arquivo fica pendente da conclusão do serviço.'}</p>
        <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setPaidDraft(null)}>Cancelar</button>
          <button type="submit" className="command-button" disabled={busy}><CheckCircle2 size={15} />{busy ? 'A guardar...' : 'Confirmar fatura paga'}</button></div>
      </form> : null}
      {issueDraft ? <form className="finance-receipt-issue-form" onSubmit={(e) => { e.preventDefault(); saveCommercial('invoiced', issueDraft.issueDate); }}>
        <div className="service-detail-payment-grid">
          <label>Data de faturação / referência<input type="date" required value={issueDraft.issueDate} readOnly={Boolean(calendarReference)} disabled={busy || loading || Boolean(registrationBlocker)}
            onChange={(e) => setIssueDraft({ issueDate: e.target.value })} /></label>
          <div className="finance-receipt-issue-preview"><span>Vencimento</span><strong>{previewDueDate ? dayLabel(previewDueDate) : '-'}</strong><small>{paymentTerm}</small></div>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setIssueDraft(null); setSaveError(''); }}>Cancelar</button>
          <button type="submit" className="command-button" disabled={busy || loading || Boolean(registrationBlocker)}><Save size={15} />Guardar faturação</button></div>
      </form> : null}
      {blocker ? <p className="muted">{registrationBlocker || 'Faturação anterior registada, sem fatura associada. As correções ao histórico mantêm-se protegidas.'}</p> : null}
      {event.invoices.map((invoice) => <div key={invoice.id} className="finance-receipt-invoice">
        <label>{invoice.number || `Fatura #${invoice.id}`} · {money.format(Number(invoice.total))}
          <select aria-label={`Estado da fatura ${invoice.number || invoice.id}`} value={invoice.status} disabled={!canUpdateInvoices || busy || loading || Boolean(error)}
            onChange={(e) => saveInvoiceStatus(invoice, e.target.value)}><option value="draft">Rascunho</option><option value="issued">Emitida</option><option value="paid">Paga</option><option value="cancelled">Anulada</option></select>
        </label>
        {canUpdateInvoices && invoiceIsIssued(invoice) && !invoiceIsPaid(invoice) ? <button type="button" className="command-button" disabled={busy || loading || Boolean(error)} onClick={() => {
          if (window.confirm(`Confirmas que recebeste integralmente ${money.format(Number(invoice.total))} da fatura ${invoice.number || invoice.id}?`)) saveInvoiceStatus(invoice, 'paid');
        }}><CheckCircle2 size={16} />Marcar fatura como paga</button> : null}
      </div>)}
      <section className="finance-receipt-list"><header><h4>Recebimentos registados</h4>
        {canWrite && !registrationBlocker && state.outstanding > 0 ? <button type="button" className="secondary-button" disabled={busy || loading || Boolean(error)}
          onClick={() => openReceipt()}><Plus size={15} />Registar recebimento</button> : null}</header>
        <ul>{rows.filter((row) => row.voided !== 'delete').map((row) => <li key={row.id}>
          <div><strong>{receiptTypeLabels[row.type]}</strong><small>{dayLabel(row.receivedAt)}{row.voided ? ' · Revertido' : ''}</small>{row.description ? <small>{row.description}</small> : null}</div>
          <strong>{money.format(row.amount)}</strong>
          {canWrite && !blocker ? <div className="finance-receipt-actions">
            {!row.voided ? <><button type="button" className="icon-button" title="Editar recebimento" aria-label="Editar recebimento" disabled={busy} onClick={() => openAction(row, 'edit')}><Edit3 size={15} /></button>
              <button type="button" className="icon-button" title="Reverter recebimento" aria-label="Reverter recebimento" disabled={busy} onClick={() => openAction(row, 'reverse')}><RotateCcw size={15} /></button></> : null}
            {receiptCanDelete(record, row) ? <button type="button" className="icon-button" title="Eliminar recebimento" aria-label="Eliminar recebimento" disabled={busy} onClick={() => openAction(row, 'delete')}><Trash2 size={15} /></button> : null}
          </div> : null}
        </li>)}</ul>
        {!rows.length ? <p className="muted">Sem recebimentos individualizados.</p> : null}
      </section>
      <details className="payment-overview-corrections"><summary>Histórico e correções</summary><ol className="receipt-audit">
        {audit.map((entry) => <li key={entry.id}><span>{dayLabel(entry.recordedAt || entry.receivedAt)} · {entry.actor?.name || 'Autor não registado'}</span>
          <strong>{entry.finance ? { archive: 'Serviço arquivado', restore: 'Serviço restaurado', allocate: 'Repartição por período guardada', invoice_paid: 'Fatura paga confirmada' }[entry.action] : entry.commercial ? `Estado financeiro: ${entry.to === 'invoiced' ? 'Faturado' : 'Automático'}`
            : entry.operation === 'edit' ? 'Recebimento corrigido' : entry.operation === 'delete' ? 'Recebimento eliminado' : entry.operation === 'reverse' || entry.type === 'reversal' ? 'Recebimento revertido' : receiptTypeLabels[entry.type] || 'Correção'}</strong>
          {entry.commercial && entry.issueDate ? <span>Emissão: {dayLabel(entry.issueDate)}{entry.previousIssueDate && entry.previousIssueDate !== entry.issueDate ? ` · Anterior: ${dayLabel(entry.previousIssueDate)}` : ''}</span> : null}
          {!entry.commercial && !entry.finance ? <span>{entry.operation === 'edit' ? `${money.format(entry.before?.amount || 0)} → ${money.format(entry.replacement.amount)}` : money.format(entry.amount)}</span> : null}</li>)}
      </ol></details>
      {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
    </div>
  </Modal>;
}
