export function readClientPaymentRecord(value) {
  if (!value) return null;
  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    return record?.version === 1 && Array.isArray(record.entries) ? record : null;
  } catch { return null; }
}

export function clientPaymentAssessment(event = {}, summary = {}) {
  const record = readClientPaymentRecord(event.clientPaymentRecord);
  const assessed = ['finalized', 'completed', 'invoiced', 'paid'].includes(event.status);
  const outstanding = summary.outstanding || 0;
  const excess = Math.max(0, Math.round(((summary.received || 0) - (summary.total || 0)) * 100) / 100);
  const fullyReceived = summary.total > 0 && outstanding === 0;
  const label = excess > 0 ? 'Recebido em excesso' : fullyReceived
    ? assessed ? 'Pago' : 'Previsto totalmente recebido'
    : summary.received > 0 ? 'Parcialmente recebido' : event.billingStatus === 'invoiced' ? 'Faturado' : 'Pendente';
  return { assessed, excess, fullyReceived, label, expectedTotal: record?.expectedTotal ?? null };
}
