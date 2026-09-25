import { CheckCircle2, LogIn, LogOut, MapPin } from 'lucide-react';
import { useState } from 'react';

function schedule(service) {
  return [service.startTime || '--:--', service.endTime || '--:--'].join(' → ');
}

export default function DailyQrServices({ payload, saving, onRegister }) {
  const [selection, setSelection] = useState(null);
  const selectedId = payload.activeAssignmentId || (selection?.revision === payload.revision ? selection.id : null);
  const current = payload.services.find((service) => service.assignmentId === selectedId && payload.candidateIds.includes(selectedId));
  const entering = current?.state.nextAction === 'check_in';
  const waitingForDay = payload.punchRetryAfterMs > 0;
  const blocked = waitingForDay || (entering ? payload.switchRetryAfterMs > 0 : current?.checkOutRetryAfterMs > 0);
  const day = new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC' }).format(new Date(payload.assignmentDate));

  return <>
    <header className="qr-check-header">
      <p>Picagens do dia · {day}</p>
      <h1>{payload.collaboratorName}</h1>
      <p>{payload.completedCount} de {payload.total} serviços concluídos</p>
    </header>

    {waitingForDay && <p className="qr-check-footnote" role="status">
      Picagens disponíveis em {day}, a partir das {payload.punchAvailableTime}.
    </p>}

    {payload.selectionRequired && <fieldset className="qr-day-selection" disabled={saving}>
      <legend>Seleciona o serviço</legend>
      {payload.services.filter((service) => payload.candidateIds.includes(service.assignmentId)).map((service) => (
        <label key={service.assignmentId}>
          <input type="radio" name="daily-service" value={service.assignmentId} checked={selectedId === service.assignmentId}
            onChange={() => setSelection({ id: service.assignmentId, revision: payload.revision })} />
          <span><strong>{service.eventName}</strong><small>{schedule(service)} · {service.role}</small>
            {(service.workLocation || service.location) && <small>{service.workLocation || service.location}</small>}</span>
        </label>
      ))}
    </fieldset>}

    {current && <section className="qr-day-current" aria-label="Serviço atual">
      <header>
        <span className={`qr-check-state qr-check-state--${current.state.key}`}>{current.state.label}</span>
        <h2>{current.eventName}</h2>
        {current.clientName && <p>{current.clientName}</p>}
        {(current.workLocation || current.location) && <p className="qr-day-location"><MapPin size={16} /><span>{[current.location, current.workLocation].filter(Boolean).join(' · ')}</span></p>}
      </header>
      <dl className="qr-check-details">
        <div><dt>Função</dt><dd>{current.role || '-'}</dd></div>
        <div><dt>Previsto</dt><dd>{schedule(current)}</dd></div>
        <div><dt>Entrada</dt><dd>{current.checkIn || 'Por registar'}</dd></div>
        <div><dt>Saída</dt><dd>{current.checkOut || 'Por registar'}</dd></div>
      </dl>
      <button type="button" className="qr-check-command" disabled={saving || blocked}
        onClick={() => onRegister(entering ? 'check-in' : 'check-out', current.assignmentId)}>
        {entering ? <LogIn size={20} /> : <LogOut size={20} />}
        {saving ? 'A registar...' : entering ? 'Dar Entrada' : 'Dar Saída'}
      </button>
      {blocked && !waitingForDay && <p className="qr-check-footnote" role="status">
        {entering ? 'Saída registada. A preparar o próximo serviço...'
          : `Entrada já registada. Podes dar saída a partir das ${current.checkOutAvailableTime}, 30 minutos após a entrada.`}
      </p>}
    </section>}

    {payload.completed ? <div className="qr-check-completed" role="status"><CheckCircle2 size={22} />Todos os serviços deste dia estão concluídos.</div>
      : !payload.candidateIds.length && <p role="status">Não existem serviços disponíveis para picar neste momento.</p>}

    <section className="qr-day-summary" aria-label="Serviços do dia">
      <h2>Serviços do dia</h2>
      <ol>{payload.services.map((service) => (
        <li key={service.assignmentId} aria-current={service.assignmentId === selectedId ? 'step' : undefined}>
          <strong>{service.eventName}</strong>
          <span>{schedule(service)}{service.workLocation ? ` · ${service.workLocation}` : ''}</span>
          <span>{service.checkIn || '--:--'} → {service.checkOut || '--:--'} · {service.expired ? 'Expirado' : service.state.label}</span>
        </li>
      ))}</ol>
    </section>
  </>;
}
