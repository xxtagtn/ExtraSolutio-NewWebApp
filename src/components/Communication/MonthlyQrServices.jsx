import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react';
import { useState } from 'react';
import DailyQrServices from './DailyQrServices.jsx';
import { qrSummaryDate } from '../../utils/qrConsultationSummary.js';
import { monthlyDaysPage, monthlyServiceDays } from '../../utils/qrMonthlyPresentation.js';
import './qrConsultation.css';

export default function MonthlyQrServices({ payload, saving, onRegister }) {
  const [expandedDay, setExpandedDay] = useState(null);
  const [navigation, setNavigation] = useState({ query: '', page: 1 });
  const currentIds = new Set(payload.active?.candidateIds || []);
  const services = payload.services.filter((service) => !currentIds.has(service.assignmentId));
  const days = monthlyServiceDays(services, navigation.query);
  const page = monthlyDaysPage(days, navigation.page);
  const month = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(payload.monthFrom));
  function search(query) {
    setNavigation({ query, page: 1 });
    setExpandedDay(null);
  }
  function goToPage(next) {
    setNavigation({ ...navigation, page: next });
    setExpandedDay(null);
  }
  return <>
    <header className="qr-check-header qr-consultation-header">
      <h1>{payload.collaboratorName}</h1>
      <p>Link de Picagens</p>
      <strong className="qr-month-label">{month.charAt(0).toUpperCase() + month.slice(1)}</strong>
      <small>{payload.closed ? 'Link terminado' : payload.checkoutOnly ? 'Apenas saída do turno em curso'
        : `Válido até ${qrSummaryDate(payload.expiresAt, payload.timeZone)}`}</small>
    </header>
    {payload.active && <section className="qr-month-active" aria-label="Picagens disponíveis">
      <h2>Picagens · {qrSummaryDate(payload.activeDay)}</h2>
      <DailyQrServices key={payload.activeDay} payload={payload.active} saving={saving}
        onRegister={onRegister} showHeader={false} />
    </section>}
    {!payload.services.length && <p className="qr-check-completed" role="status">{payload.closed
      ? 'Saída registada. Este link terminou.' : 'Sem serviços pendentes neste mês.'}</p>}
    {services.length > 0 && <section className="qr-month-history" aria-label="Próximos Serviços">
      <h2>Próximos Serviços</h2>
      <div className="qr-month-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" aria-label="Pesquisar evento ou dia" placeholder="Pesquisar evento ou dia"
          value={navigation.query} onChange={(event) => search(event.target.value)} />
        {navigation.query && <button type="button" onClick={() => search('')} aria-label="Limpar pesquisa"
          title="Limpar pesquisa"><X size={17} /></button>}
      </div>
      {!days.length && <p className="qr-check-footnote" role="status">Sem resultados para esta pesquisa.</p>}
      {page.items.map(([day, rows]) => <details key={day} className="qr-month-day" open={expandedDay === day}>
        <summary onClick={(event) => { event.preventDefault(); setExpandedDay(expandedDay === day ? null : day); }}>
          <CalendarDays size={17} aria-hidden="true" /><strong>{qrSummaryDate(day)}</strong>
          <span className="qr-month-day-count">{rows.length} {rows.length === 1 ? 'serviço' : 'serviços'}</span>
          <ChevronDown size={17} className="qr-month-chevron" aria-hidden="true" />
        </summary>
        <div className="qr-month-day-records">{rows.map((service) => <article key={service.assignmentId}
          className="qr-consultation-record qr-pending-service">
          <header>
            <h2>{service.eventName}</h2>
            <p>{service.role || '-'}</p>
            {(service.location || service.workLocation) && <p className="qr-day-location"><MapPin size={16} />
              <span>{[service.location, service.workLocation].filter(Boolean).join(' · ')}</span></p>}
          </header>
          <dl className="qr-consultation-planned"><div><dt>Horário previsto</dt>
            <dd>{service.startTime || '--:--'} → {service.endTime || '--:--'}</dd></div></dl>
        </article>)}</div>
      </details>)}
      {page.total > 0 && <div className="qr-month-pagination">
        <span role="status">{page.from}–{page.to} de {page.total} {page.total === 1 ? 'dia' : 'dias'}</span>
        {page.totalPages > 1 && <nav aria-label="Páginas de próximos serviços">
          <button type="button" disabled={page.page === 1} onClick={() => goToPage(page.page - 1)}
            aria-label="Página anterior" title="Página anterior"><ChevronLeft size={19} /></button>
          <span>Página {page.page} de {page.totalPages}</span>
          <button type="button" disabled={page.page === page.totalPages} onClick={() => goToPage(page.page + 1)}
            aria-label="Página seguinte" title="Página seguinte"><ChevronRight size={19} /></button>
        </nav>}
      </div>}
    </section>}
  </>;
}
