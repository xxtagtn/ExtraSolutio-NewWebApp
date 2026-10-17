import { useRef, useState } from 'react';
import { Save, RotateCcw, Trash2 } from 'lucide-react';
import Modal from '../UI/Modal.jsx';
import { money } from '../../utils/formatters.js';
import { receiptTypeLabels } from '../../utils/clientReceiptMovements.js';
import { paymentFinancialSnapshot } from '../../utils/clientPaymentAdjustment.js';

export default function ClientReceiptEditor({ event, movement, action, saving, onSubmit, onClose }) {
  const [draft, setDraft] = useState({ amount: String(movement.amount).replace('.', ','), receivedAt: movement.receivedAt?.slice(0, 10) || '',
    type: movement.type, description: movement.description || '' });
  const [error, setError] = useState('');
  const [allocate, setAllocate] = useState(Boolean(movement.fiscal?.allocations?.length));
  const [allocations, setAllocations] = useState(Object.fromEntries((movement.fiscal?.allocations || []).map((row) => [row.key, String(row.amount)])));
  const pending = useRef(false);
  const snapshot = movement.salesSnapshot || paymentFinancialSnapshot(event);
  const components = (snapshot?.components || []).filter((row) => row.base + row.tax > 0);
  const editing = ['edit', 'create'].includes(action);
  const title = action === 'create' ? 'Registar recebimento' : action === 'edit' ? 'Editar recebimento' : action === 'delete' ? 'Eliminar recebimento?' : 'Reverter recebimento?';
  async function submit(e) {
    e.preventDefault();
    if (pending.current || saving) return;
    pending.current = true; setError('');
    try {
      await onSubmit({ ...draft, action, ...(allocate ? { allocations: components.map((row) => ({ key: row.key,
        amount: Number(String(allocations[row.key] || 0).replace(',', '.')) })) } : {}) });
    } catch (err) { setError(err.message || 'Não foi possível alterar este recebimento.'); }
    finally { pending.current = false; }
  }
  return <Modal title={title} onClose={() => { if (!saving) onClose(); }} preventFocusScroll>
    <form className="event-additional-payment-form" onSubmit={submit}>
      <p><strong>{receiptTypeLabels[movement.type]}</strong> · {money.format(movement.amount)}</p>
      {editing ? <>
        <div className="service-detail-payment-grid">
          <label>Valor recebido<input inputMode="decimal" value={draft.amount} disabled={saving} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></label>
          <label>Data do recebimento<input type="date" value={draft.receivedAt} disabled={saving} onChange={(e) => setDraft({ ...draft, receivedAt: e.target.value })} /></label>
          <label>Tipo do movimento<select aria-label="Tipo do movimento" value={draft.type} disabled={saving} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {Object.entries(receiptTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Descrição<input maxLength={400} value={draft.description} disabled={saving} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        </div>
        {components.length ? <fieldset className="receipt-allocation">
          <label className="check-inline"><input type="checkbox" checked={allocate} disabled={saving} onChange={(e) => setAllocate(e.target.checked)} />Discriminar componentes pagos</label>
          {allocate ? <>
            {!movement.salesSnapshot ? <p className="muted">Configuração fiscal atual do evento. Confirma os componentes deste recebimento.</p> : null}
            {components.map((row) => <label key={row.key}>{row.label} · {row.rate === '0' ? 'sem IVA' : `IVA ${row.rate}${row.rate.includes('%') ? '' : '%'}`}
              <input inputMode="decimal" aria-label={`Recebido em ${row.label}`} placeholder="0,00" value={allocations[row.key] || ''} disabled={saving}
                onChange={(e) => setAllocations({ ...allocations, [row.key]: e.target.value })} /></label>)}
          </> : null}
        </fieldset> : null}
      </> : <p>{action === 'delete' ? 'Tem a certeza de que pretende eliminar este recebimento?' : 'Pretende reverter apenas este recebimento?'} {action === 'delete' && movement.voided === 'reverse' ? 'Este recebimento já foi revertido. Será removido da lista, sem alterar os totais.' : 'Os restantes movimentos serão mantidos.'} Esta operação fica no histórico e não efetua um reembolso.</p>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button className={`command-button${editing ? '' : ' command-button--danger'}`} type="submit" disabled={saving}>
          {editing ? <Save size={15} /> : action === 'delete' ? <Trash2 size={15} /> : <RotateCcw size={15} />}
          {saving ? 'A guardar...' : editing ? 'Guardar recebimento' : action === 'delete' ? 'Eliminar recebimento' : 'Reverter recebimento'}
        </button></div>
    </form>
  </Modal>;
}
