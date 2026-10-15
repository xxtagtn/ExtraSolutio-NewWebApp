import { eventStaffVatRate } from '../../utils/eventSalesTax.js';

export default function StaffVatControl({ event, onChange, disabled = false }) {
  const rate = eventStaffVatRate(event);
  return <div className="service-staff-vat-control">
    <strong>Faturação do Staff</strong>
    <label className="check-inline service-check">
      <input type="checkbox" checked={rate > 0} disabled={disabled}
        onChange={(change) => onChange(change.target.checked ? 23 : 0)} />
      <span>Aplicar IVA ({rate > 0 ? rate : 23}%) ao valor do Staff cobrado ao cliente</span>
    </label>
    <small className="muted">{disabled ? 'A faturação deste evento está fechada.' : rate > 0
      ? 'O valor do Staff faturado ao cliente será acrescido de IVA.'
      : 'O valor do Staff faturado ao cliente será considerado sem acréscimo de IVA.'}</small>
  </div>;
}
