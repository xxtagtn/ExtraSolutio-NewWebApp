import { money, date } from '../../utils/formatters.js';

const day = (value) => value ? date.format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : '-';
export default function ClientBillingPeriods({ finance }) {
  return <section className="client-billing-periods">
    <header><strong>{finance.billingLabel}</strong></header>
    {(finance.prepaymentStages?.length ? [] : finance.periods).map((period) => <div className="client-billing-period" key={period.key}>
      <strong>{day(period.days[0])}{period.days[0] !== period.days.at(-1) ? ` - ${day(period.days.at(-1))}` : ''}</strong>
      <dl><div><dt>Faturação/referência</dt><dd>{day(period.referenceDate)}</dd></div><div><dt>Vencimento</dt><dd>{day(period.dueDate)}</dd></div>
        <div><dt>Valor</dt><dd>{period.total === null ? 'Por repartir' : money.format(period.total)}</dd></div>
        <div><dt>Recebido</dt><dd>{period.received === null ? 'Por repartir' : money.format(period.received)}</dd></div>
        <div><dt>Por receber</dt><dd>{period.outstanding === null ? 'Por repartir' : money.format(period.outstanding)}</dd></div></dl>
      <small className={period.status === 'overdue' && finance.billingStatus === 'invoiced' ? 'client-finance-overdue' : ''}>{period.status === 'overdue' && finance.billingStatus !== 'invoiced' ? 'Faturação por regularizar' : period.label}</small>
    </div>)}
    {(finance.prepaymentStages || []).map((stage) => <div className="client-billing-period" key={stage.key}><strong>{stage.label}</strong>
      <dl><div><dt>Valor previsto</dt><dd>{money.format(stage.total)}</dd></div><div><dt>Prazo</dt><dd>{day(stage.dueDate)}</dd></div>
        <div><dt>Por receber</dt><dd>{money.format(stage.outstanding)}</dd></div></dl>
      <small className={stage.status === 'overdue' ? 'client-finance-overdue' : ''}>{stage.status === 'overdue' ? 'Pagamento em falta' : stage.label === 'Sinalização na adjudicação' && !stage.dueDate ? 'Data de adjudicação não registada' : stage.outstanding === 0 ? 'Recebido' : 'A aguardar pagamento'}</small>
    </div>)}
    {finance.allocationRequired ? <p className="form-error">Repartição por confirmar. Os totais e os recebimentos do serviço estão preservados.</p> : null}
  </section>;
}
