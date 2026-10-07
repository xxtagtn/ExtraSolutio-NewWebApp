import { ChevronDown } from 'lucide-react';

export default function BalanceKpi({ icon: Icon, label, value, detail, tone = 'accent', onClick, expanded }) {
  const Element = onClick ? 'button' : 'article';
  return (
    <Element className={`balance-kpi balance-kpi--${tone}`} {...(onClick ? {
      type: 'button', onClick, 'aria-expanded': expanded, 'aria-controls': 'balance-margin-detail',
    } : {})}>
      <span className="balance-kpi__icon"><Icon size={22} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}{onClick ? <ChevronDown size={13} /> : null}</small> : null}
      </div>
    </Element>
  );
}
