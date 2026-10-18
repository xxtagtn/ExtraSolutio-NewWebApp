import { money } from '../../utils/formatters.js';

export default function InternalCostAmount({ total, travel = 0, complete = true }) {
  return <span className="internal-cost-amount">
    <span>{money.format(complete ? total - travel : total)}</span>
    {complete && travel !== 0 ? <small>Deslocação: {money.format(travel)}</small> : null}
    {!complete ? <small>Staff e deslocação por discriminar</small> : null}
  </span>;
}
