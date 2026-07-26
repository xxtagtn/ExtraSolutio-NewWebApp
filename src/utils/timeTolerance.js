import {
  roundedBillableHours,
  roundedClockTime,
} from './serviceFinance.js';

function timeMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function clockDifference(first, second) {
  const firstMinutes = timeMinutes(first);
  const secondMinutes = timeMinutes(second);
  if (firstMinutes === null || secondMinutes === null) return null;
  const difference = Math.abs(firstMinutes - secondMinutes);
  return Math.min(difference, (24 * 60) - difference);
}

function assessmentLevel(diffMinutes) {
  if (diffMinutes <= 15) return { tone: 'success', label: 'Dentro da tolerância', isDifference: false, needsAttention: false };
  if (diffMinutes <= 30) return { tone: 'warning', label: 'Atenção', isDifference: true, needsAttention: true };
  if (diffMinutes <= 60) return { tone: 'orange', label: 'Divergência relevante', isDifference: true, needsAttention: true };
  if (diffMinutes <= 120) return { tone: 'danger', label: 'Divergência crítica', isDifference: true, needsAttention: true };
  return { tone: 'critical', label: 'Possível erro de registo', isDifference: true, needsAttention: true };
}

function differenceDetail(entryDiffMinutes, exitDiffMinutes) {
  const parts = [];
  if (entryDiffMinutes > 0 || exitDiffMinutes === 0) parts.push(`Entrada: ${entryDiffMinutes} min`);
  if (exitDiffMinutes > 0 || entryDiffMinutes === 0) parts.push(`Saída: ${exitDiffMinutes} min`);
  return parts.join(' · ');
}

function durationLabel(hours) {
  const totalMinutes = Math.round(Number(hours || 0) * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${wholeHours}:${String(minutes).padStart(2, '0')}h`;
}

function roundingImpact(times = {}) {
  const staffCheckIn = roundedClockTime(times.checkIn);
  const staffCheckOut = roundedClockTime(times.checkOut);
  const clientCheckIn = roundedClockTime(times.clientCheckIn);
  const clientCheckOut = roundedClockTime(times.clientCheckOut);
  if (!staffCheckIn || !staffCheckOut || !clientCheckIn || !clientCheckOut) return null;

  const staffHours = roundedBillableHours(times.checkIn, times.checkOut);
  const clientHours = roundedBillableHours(times.clientCheckIn, times.clientCheckOut);
  const roundedTimesMatch = staffCheckIn === clientCheckIn && staffCheckOut === clientCheckOut;
  const roundedHoursMatch = Math.abs(staffHours - clientHours) < 0.001;

  return {
    hasImpact: !roundedTimesMatch || !roundedHoursMatch,
    impactMinutes: Math.round(Math.abs(staffHours - clientHours) * 60),
    detail: [
      `Staff arredondado: ${staffCheckIn}-${staffCheckOut} (${durationLabel(staffHours)})`,
      `Cliente arredondado: ${clientCheckIn}-${clientCheckOut} (${durationLabel(clientHours)})`,
    ].join(' · '),
  };
}

export function resolvePlannedTimes(assignment = {}, event = {}) {
  return {
    plannedCheckIn: assignment.plannedCheckIn || event.startTime || '',
    plannedCheckOut: assignment.plannedCheckOut || event.endTime || '',
  };
}

export function assessTimeTolerance(times = {}) {
  const entryDiffMinutes = clockDifference(times.checkIn, times.clientCheckIn);
  const exitDiffMinutes = clockDifference(times.checkOut, times.clientCheckOut);
  if (entryDiffMinutes === null || exitDiffMinutes === null) {
    return {
      tone: 'info',
      label: 'Aguardar validação',
      diffMinutes: null,
      entryDiffMinutes: null,
      exitDiffMinutes: null,
      detail: '',
      isDifference: false,
      needsAttention: true,
    };
  }

  const diffMinutes = Math.max(entryDiffMinutes, exitDiffMinutes);
  const level = assessmentLevel(diffMinutes);
  const detail = differenceDetail(entryDiffMinutes, exitDiffMinutes);
  const roundedImpact = !level.isDifference ? roundingImpact(times) : null;
  if (roundedImpact?.hasImpact) {
    return {
      tone: 'orange',
      label: 'Impacto do arredondamento',
      diffMinutes,
      entryDiffMinutes,
      exitDiffMinutes,
      roundingImpactMinutes: roundedImpact.impactMinutes,
      detail: `${detail} · ${roundedImpact.detail}`,
      isDifference: true,
      needsAttention: true,
    };
  }

  return {
    ...level,
    diffMinutes,
    entryDiffMinutes,
    exitDiffMinutes,
    detail,
  };
}
