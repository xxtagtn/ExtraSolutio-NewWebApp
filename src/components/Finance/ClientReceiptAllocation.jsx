import { money } from '../../utils/formatters.js';

export function receiptAllocationInput(snapshot, draft) {
  return draft.enabled ? (snapshot?.components || []).filter((row) => row.base + row.tax > 0)
    .map((row) => ({ key: row.key, amount: Number(String(draft.amounts[row.key] || 0).replace(',', '.')) })) : undefined;
}

export default function ClientReceiptAllocation({ snapshot, value, onChange, disabled }) {
  const components = (snapshot?.components || []).filter((row) => row.base + row.tax > 0);
  if (!components.length) return null;
  const allocated = Object.values(value.amounts).reduce((sum, amount) => sum + (Number(String(amount).replace(',', '.')) || 0), 0);
  return <fieldset className="receipt-allocation">
    <label className="check-inline"><input type="checkbox" checked={value.enabled} disabled={disabled}
      onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />Discriminar componentes pagos</label>
    {value.enabled ? <>
      {components.map((row) => <label key={row.key}>{row.label} · {row.rate === '0' ? 'sem IVA' : `IVA ${row.rate}${row.rate.includes('%') ? '' : '%'}`}
        <input inputMode="decimal" aria-label={`Recebido em ${row.label}`} placeholder="0,00" value={value.amounts[row.key] || ''} disabled={disabled}
          onChange={(e) => onChange({ ...value, amounts: { ...value.amounts, [row.key]: e.target.value } })} /></label>)}
      <span className="muted">Total distribuído: <strong>{money.format(allocated)}</strong></span>
    </> : null}
  </fieldset>;
}
