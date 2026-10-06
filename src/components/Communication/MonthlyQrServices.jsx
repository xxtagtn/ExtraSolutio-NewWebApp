import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Search, X } from 'lucide-react';
import { useState } from 'react';
import DailyQrServices from './DailyQrServices.jsx';
import { QrConsultationRecord, QrSummaryCopyButton } from './QrConsultationSummary.jsx';
import { qrSummaryDate, qrSummaryText } from '../../utils/qrConsultationSummary.js';
import { monthlyDayInterval, monthlyDaysPage, monthlyServiceDays } from '../../utils/qrMonthlyPresentation.js';

export default function MonthlyQrServices({ payload, saving, onRegister }) {
  const [expandedDay, setExpandedDay] = useState(null);
  const upcoming = payload.services.filter((service) => service.upcoming);
  const history = payload.services.filter((service) => !service.upcoming);
  const month = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(payload.historyFrom));
  return <>
    <header className="qr-check-header qr-consultation-header">
      <h1>{payload.collaboratorName}</h1>
      <p>Serviços e horários</p>
      <strong className="qr-month-label">{month.charAt(0).toUpperCase() + month.slice(1)}</strong>
      <small>{payload.consultationOnly ? 'Apenas consulta' : `Picagens até ${qrSummaryDate(payload.punchExpiresAt, payload.timeZone)}`} · Consulta até {qrSummaryDate(payload.consultationExpiresAt, payload.timeZone)}</small>
    </header>
    {payload.active && <section className="qr-month-active" aria-label="Picagens disponíveis">
      <h2>Picagens · {qrSummaryDate(payload.activeDay)}</h2>
      <DailyQrServices key={payload.activeDay} payload={payload.active} saving={saving} onRegister={onRegister} showOverview={false} />
    </section>}
    <MonthlyServiceDays title="Próximos serviços" services={upcoming} empty="Sem próximos serviços neste mês."
      expandedDay={expandedDay} onExpand={setExpandedDay} />
    <MonthlyServiceDays title="Horários realizados" services={history} empty="Sem horários realizados neste período." searchable
      expandedDay={expandedDay} onExpand={setExpandedDay} />
    <QrSummaryCopyButton key={qrSummaryText(payload)} payload={payload} />
  </>;
}

function MonthlyServiceDays({ title, services, empty, searchable = false, expandedDay, onExpand }) {
  const [navigation, setNavigation] = useState({ query: '', page: 1 });
  const days = monthlyServiceDays(services, navigation.query);
  const page = monthlyDaysPage(days, navigation.page);
  function search(query) {
    setNavigation({ query, page: 1 });
    onExpand(null);
  }
  function goToPage(next) {
    setNavigation({ ...navigation, page: next });
    onExpand(null);
  }
  return <section className="qr-month-history" aria-label={title}>
    <h2>{title}</h2>
    {searchable && services.length > 0 && <div className="qr-month-search">
      <Search size={17} aria-hidden="true" />
      <input type="search" aria-label="Pesquisar evento ou dia" placeholder="Pesquisar evento ou dia"
        value={navigation.query} onChange={(event) => search(event.target.value)} />
      {navigation.query && <button type="button" onClick={() => search('')} aria-label="Limpar pesquisa" title="Limpar pesquisa"><X size={17} /></button>}
    </div>}
    {!services.length && <p className="qr-check-footnote">{empty}</p>}
    {services.length > 0 && !days.length && <p className="qr-check-footnote" role="status">Sem resultados para esta pesquisa.</p>}
    {page.items.map(([day, services]) => {
      const dayKey = `${title}:${day}`;
      return <details key={day} className="qr-month-day" open={expandedDay === dayKey}>
        <summary onClick={(event) => { event.preventDefault(); onExpand(expandedDay === dayKey ? null : dayKey); }}>
          <CalendarDays size={17} aria-hidden="true" /><strong>{qrSummaryDate(day)}</strong>
          <span className="qr-month-day-count">{services.length} {services.length === 1 ? 'serviço' : 'serviços'}
            {!services[0].upcoming && <small title="Horas trabalhadas">{monthlyDayInterval(services)}</small>}</span>
          <ChevronDown size={17} className="qr-month-chevron" aria-hidden="true" /></summary>
        <div className="qr-month-day-records">{services.map((service) => <div key={service.assignmentId}>
          <p className="qr-month-schedule"><span>{service.upcoming ? 'Confirmado' : service.readOnly ? 'Apenas consulta' : 'Serviço do dia'}</span></p>
          <QrConsultationRecord service={service} showRecordedHours={!service.upcoming} compact />
          {service.requiresNewLinkForCheckout && <p className="qr-month-renewal-note" role="note">
            <CircleAlert size={16} /><span>Saída no mês seguinte: exige novo link mensal.</span>
          </p>}
        </div>)}</div>
      </details>;
    })}
    {page.total > 0 && <div className="qr-month-pagination">
      <span role="status">{page.from}–{page.to} de {page.total} {page.total === 1 ? 'dia' : 'dias'}</span>
      {page.totalPages > 1 && <nav aria-label={`Páginas de ${title.toLocaleLowerCase('pt-PT')}`}>
        <button type="button" disabled={page.page === 1} onClick={() => goToPage(page.page - 1)} aria-label="Página anterior" title="Página anterior"><ChevronLeft size={19} /></button>
        <span>Página {page.page} de {page.totalPages}</span>
        <button type="button" disabled={page.page === page.totalPages} onClick={() => goToPage(page.page + 1)} aria-label="Página seguinte" title="Página seguinte"><ChevronRight size={19} /></button>
      </nav>}
    </div>}
    </section>;
}
