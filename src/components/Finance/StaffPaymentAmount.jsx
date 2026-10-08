import { money } from '../../utils/formatters.js';

export default function StaffPaymentAmount({ amount, withVat = false, emphasized = true }) {
  const Value = emphasized ? 'strong' : 'span';
  if (!withVat) return <Value>{money.format(amount.total)}</Value>;
  return <span className="finance-payment-amount">
    <Value title={amount.advances > 0 || amount.car > 0 ? 'Saldo sem IVA após adiantamentos, incluindo carro sem IVA adicional' : 'Valor base para recibo, sem IVA'}>{money.format(amount.base)}</Value>
    <small className="finance-payment-amount__vat">{money.format(amount.total)} c/ IVA</small>
    {amount.advances > 0 || amount.car > 0 ? <small className="finance-payment-amount__receipt">Base serviços: {money.format(amount.receiptBase)}</small> : null}
  </span>;
}
