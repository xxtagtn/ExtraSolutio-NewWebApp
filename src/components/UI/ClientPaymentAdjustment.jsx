import { money } from '../../utils/formatters.js';

export default function ClientPaymentAdjustment({ breakdown, history = false }) {
  if (!breakdown?.available) return <small className="client-adjustment-unavailable">Base e IVA indisponíveis: o recebimento original não tem discriminação fiscal guardada.</small>;
  const partial = breakdown.receivedTowards > 0;
  const rates = [...new Set((breakdown.components || []).filter((row) => row.base || row.tax).map((row) => row.rate))];
  const rate = rates.length === 1 && rates[0] ? rates[0] === '0' ? ' (sem acréscimo)' : ` (${rates[0]}${rates[0].includes('%') ? '' : '%'})` : '';
  return <div className="client-adjustment-detail">
    <dl>
      <div><dt>{partial || history ? 'Base total do acerto' : 'Base a faturar'} <small>sem IVA</small></dt><dd>{money.format(breakdown.base)}</dd></div>
      <div><dt>IVA{rate}</dt><dd>{money.format(breakdown.tax)}</dd></div>
      {partial || history ? <div><dt>Total do acerto <small>com IVA aplicável</small></dt><dd>{money.format(breakdown.total)}</dd></div> : null}
      {partial ? <div><dt>Já recebido deste acerto</dt><dd>{money.format(breakdown.receivedTowards)}</dd></div> : null}
    </dl>
    {breakdown.components?.length > 1 ? <details><summary>Componentes do acerto</summary><ul>
      {breakdown.components.map((row) => <li key={row.key}><span>{row.label} · {row.rate === '0' ? 'sem IVA' : row.rate ? `IVA ${row.rate}${row.rate.includes('%') ? '' : '%'}` : 'IVA'}</span>
        <span>{money.format(row.base)} + {money.format(row.tax)} IVA</span></li>)}
    </ul></details> : null}
  </div>;
}
