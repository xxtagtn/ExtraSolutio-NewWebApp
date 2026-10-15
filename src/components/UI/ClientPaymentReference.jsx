import { prepaymentReferenceAmounts } from '../../utils/prepaymentPolicy.js';
import { money } from '../../utils/formatters.js';

export default function ClientPaymentReference({ total }) {
  const reference = prepaymentReferenceAmounts(total);
  return (
    <div className="client-payment-reference" aria-label="Referência 70% e 30%">
      <span className="client-payment-reference__label">Valores de referência</span>
      <dl>
        <div><dt>Total</dt><dd>{money.format(reference.total)}</dd></div>
        <div><dt>70%</dt><dd>{money.format(reference.seventy)}</dd></div>
        <div><dt>30%</dt><dd>{money.format(reference.thirty)}</dd></div>
      </dl>
    </div>
  );
}
