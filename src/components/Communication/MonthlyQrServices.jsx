import { CalendarDays, ChevronDown, CircleAlert } from 'lucide-react';
import DailyQrServices from './DailyQrServices.jsx';
import { QrConsultationRecord, QrSummaryCopyButton } from './QrConsultationSummary.jsx';
import { qrSummaryDate, qrSummaryText } from '../../utils/qrConsultationSummary.js';

export default function MonthlyQrServices({ payload, saving, onRegister }) {
  const upcoming = payload.services.filter((service) => service.upcoming);
  const history = payload.services.filter((service) => !service.upcoming);
  return <>
    <header className="qr-check-header qr-consultation-header">
      <h1>{payload.collaboratorName}</h1>
      <p>Serviços e horários</p>
      <small>{payload.consultationOnly ? 'Apenas consulta' : `Picagens até ${qrSummaryDate(payload.punchExpiresAt, payload.timeZone)}`} · Consulta até {qrSummaryDate(payload.consultationExpiresAt, payload.timeZone)}</small>
    </header>
    {payload.active && <section className="qr-month-active" aria-label="Picagens disponíveis">
      <h2>Picagens · {qrSummaryDate(payload.activeDay)}</h2>
      <DailyQrServices key={payload.activeDay} payload={payload.active} saving={saving} onRegister={onRegister} showOverview={false} />
    </section>}
    <MonthlyServiceDays title="Próximos serviços" services={upcoming} empty="Sem próximos serviços neste mês." />
    <MonthlyServiceDays title="Horários realizados" services={history} empty="Sem horários realizados neste período." />
    <QrSummaryCopyButton key={qrSummaryText(payload)} payload={payload} />
  </>;
}

function MonthlyServiceDays({ title, services, empty }) {
  const days = new Map();
  for (const service of services) {
    if (!days.has(service.assignmentDate)) days.set(service.assignmentDate, []);
    days.get(service.assignmentDate).push(service);
  }
  return <section className="qr-month-history" aria-label={title}>
    <h2>{title}</h2>
    {!services.length && <p className="qr-check-footnote">{empty}</p>}
    {[...days].map(([day, services]) => <details key={day} className="qr-month-day">
        <summary><CalendarDays size={17} /><strong>{qrSummaryDate(day)}</strong>
          <span>{services.length} {services.length === 1 ? 'serviço' : 'serviços'}</span><ChevronDown size={17} className="qr-month-chevron" /></summary>
        <div className="qr-month-day-records">{services.map((service) => <div key={service.assignmentId}>
          <p className="qr-month-schedule">{service.startTime || '--:--'} → {service.endTime || '--:--'}
            <span>{service.upcoming ? 'Confirmado' : service.readOnly ? 'Apenas consulta' : 'Serviço do dia'}</span></p>
          <QrConsultationRecord service={service} showRecordedHours={!service.upcoming} />
          {service.requiresNewLinkForCheckout && <p className="qr-month-renewal-note" role="note">
            <CircleAlert size={16} /><span>Saída no mês seguinte: exige novo link mensal.</span>
          </p>}
        </div>)}</div>
      </details>)}
    </section>;
}
