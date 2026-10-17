import { money } from '../../utils/formatters.js';

export default function ClientPaymentTax({ value, total }) {
  return <dd>
    <strong className={`payment-metric-base${value ? '' : ' payment-tax-pending'}`}
      aria-label={value ? `${money.format(value.base)} sem IVA` : 'Valor sem IVA por discriminar'}
      title={value ? 'Sem IVA' : 'Sem IVA por discriminar'}>{value ? money.format(value.base) : '—'}</strong>
    <small className="payment-metric-inclusive"><span className="payment-metric-gross">{money.format(total)}</span> c/ IVA</small>
  </dd>;
}
