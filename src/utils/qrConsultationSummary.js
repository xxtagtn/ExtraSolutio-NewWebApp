function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// A clock interval for consultation only: never use it for billing or staff pay.
export function recordedIntervalLabel(start, end) {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) return 'Incompleto';
  const minutes = (to - from + 1440) % 1440;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}h`;
}

export function qrSummaryDate(value, timeZone = 'UTC') {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat('pt-PT', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed) : '-';
}

export function qrSummaryRecords(payload) {
  return ['day', 'month'].includes(payload.scope) ? payload.services : [payload];
}

export function qrPlannedSchedule(service) {
  return `${(service.plannedCheckIn ?? service.startTime) || '--:--'} → ${(service.plannedCheckOut ?? service.endTime) || '--:--'}`;
}

export function qrSummaryText(payload) {
  const lines = ['ExtraSolutio · Resumo de horários', payload.collaboratorName,
    payload.scope === 'month' ? `Desde ${qrSummaryDate(payload.historyFrom)}` : qrSummaryDate(payload.assignmentDate)];
  for (const service of qrSummaryRecords(payload)) {
    if (payload.scope === 'month' && service.upcoming) continue;
    lines.push('', service.eventName);
    if (payload.scope === 'month') lines.push(`Dia: ${qrSummaryDate(service.assignmentDate)}`);
    if (service.role) lines.push(`Função: ${service.role}`);
    lines.push(`Horário previsto: ${qrPlannedSchedule(service)}`, 'Horário de picagem:');
    lines.push(`Entrada registada: ${service.checkIn || 'Sem registo'}`, `Saída registada: ${service.checkOut || 'Sem registo'}`,
      `Horas trabalhadas: ${recordedIntervalLabel(service.checkIn, service.checkOut)}`);
  }
  return lines.join('\n');
}
