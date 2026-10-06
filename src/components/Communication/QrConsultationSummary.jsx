import { Check, Copy, Eye, MapPin } from 'lucide-react';
import { useState } from 'react';
import { qrSummaryDate, qrSummaryRecords, qrSummaryText, recordedIntervalLabel } from '../../utils/qrConsultationSummary.js';
import './qrConsultation.css';

export function QrSummaryCopyButton({ payload }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const text = qrSummaryText(payload);

  async function copy() {
    try {
      await window.navigator.clipboard.writeText(text);
      setCopied(true);
      setManualCopy(false);
    } catch {
      setCopied(false);
      setManualCopy(true);
    }
  }

  return <div className="qr-summary-copy">
    <button type="button" className="secondary-button" onClick={copy}>
      {copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Resumo copiado' : 'Copiar resumo'}
    </button>
    {copied && <span className="qr-check-footnote" role="status">Resumo copiado.</span>}
    {manualCopy && <label className="qr-summary-manual-copy">
      <span role="status">A cópia automática não está disponível. Seleciona o resumo para copiar.</span>
      <textarea aria-label="Resumo de horários para copiar" readOnly value={text} onFocus={(event) => event.target.select()} />
    </label>}
  </div>;
}

export default function QrConsultationSummary({ payload }) {
  return <>
    <header className="qr-check-header qr-consultation-header">
      <span className="qr-consultation-mode"><Eye size={16} />Apenas consulta</span>
      <h1>Consulta de horários</h1>
      <p>{payload.collaboratorName} · {qrSummaryDate(payload.assignmentDate)}</p>
      <small>Disponível até {qrSummaryDate(payload.consultationExpiresAt, payload.timeZone || 'Europe/Lisbon')}</small>
    </header>
    <div className="qr-consultation-records">
      {qrSummaryRecords(payload).map((service, index) => (
        <QrConsultationRecord key={service.assignmentId || index} service={service} />
      ))}
    </div>
    <QrSummaryCopyButton key={qrSummaryText(payload)} payload={payload} />
  </>;
}

export function QrConsultationRecord({ service, showRecordedHours = true }) {
  return <section className="qr-consultation-record" aria-label={`Horários de ${service.eventName}`}>
    <header><h2>{service.eventName}</h2>
      {(service.role || service.clientName) && <p>{[service.role, service.clientName].filter(Boolean).join(' · ')}</p>}
      {(service.workLocation || service.location) && <p className="qr-day-location"><MapPin size={15} /><span>{[service.location, service.workLocation].filter(Boolean).join(' · ')}</span></p>}
    </header>
    {showRecordedHours && <dl className="qr-check-details">
      <div><dt>Entrada registada</dt><dd>{service.checkIn || 'Sem registo'}</dd></div>
      <div><dt>Saída registada</dt><dd>{service.checkOut || 'Sem registo'}</dd></div>
      <div><dt>Intervalo registado</dt><dd>{recordedIntervalLabel(service.checkIn, service.checkOut)}</dd></div>
      <div><dt>Validação</dt><dd>{service.validationStatus === 'validated' ? 'Validado' : 'Por validar'}</dd></div>
      {service.validationStatus === 'validated' && service.validatedCheckIn && service.validatedCheckOut && (
        <div><dt>Horário validado</dt><dd>{service.validatedCheckIn} → {service.validatedCheckOut}</dd></div>
      )}
    </dl>}
  </section>;
}
