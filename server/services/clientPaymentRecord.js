import { randomUUID } from 'node:crypto';
import { clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';

const cents = (value) => Math.round(Number(value || 0) * 100);
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;

export function clientPaymentRecordPatch(event, patch = {}, { type, now = new Date(), legacyInvoiced = false } = {}) {
  const previous = clientPaymentSummary(event);
  const currentRecord = readClientPaymentRecord(event.clientPaymentRecord);
  if (event.clientPaymentRecord && !currentRecord) {
    throw Object.assign(new Error('O histórico de recebimentos não é válido. Confirma os registos antes de continuar.'), { statusCode: 422, expose: true });
  }
  const next = { ...event, ...patch };
  // Materialize an old implicit settlement before its total can change.
  const storedPaid = Number(event.paidAmount || 0);
  const materialize = !currentRecord && event.billingStatus === 'paid'
    && (storedPaid === 0 || storedPaid === Number(event.signaledAmount || 0));
  const paidAmount = patch.paidAmount === undefined && materialize ? previous.received : patch.paidAmount;
  if (paidAmount !== undefined) next.paidAmount = paidAmount;
  // A recorded cumulative value is authoritative, including a zero after reversal.
  next.clientPaymentRecord = { version: 1, entries: [] };
  const following = clientPaymentSummary(next);
  if (!currentRecord && previous.received === 0 && following.received === 0 && !legacyInvoiced) return {};
  const record = currentRecord ? globalThis.structuredClone(currentRecord) : { version: 1, expectedTotal: null, entries: [] };
  if (legacyInvoiced) record.legacyInvoiced = true;
  const append = (entryType, amount, receivedAt, source) => record.entries.push({
    id: randomUUID(), type: entryType, amount, receivedAt: day(receivedAt), source, recordedAt: now.toISOString(),
  });
  if (!currentRecord && previous.received > 0) {
    const initialSignal = Math.min(previous.signal, previous.received);
    if (initialSignal > 0) append('signal', initialSignal, event.signaledAt, 'legacy');
    if (previous.received > initialSignal) append('remaining', Number((previous.received - initialSignal).toFixed(2)), event.billingPaymentDate, 'legacy');
    if (event.billingStatus === 'paid') record.expectedTotal = previous.total;
  }
  const delta = cents(following.received) - cents(previous.received);
  if (delta) {
    const entryType = delta < 0 ? type || 'correction' : type || (previous.received === 0 ? 'signal'
      : previous.remainingReceived === 0 ? 'remaining' : 'adjustment');
    append(entryType, delta / 100, entryType === 'signal' ? next.signaledAt : next.billingPaymentDate, 'recorded');
  }
  const referenceTotal = previous.received === 0 ? following.total : previous.total;
  if (record.expectedTotal == null && following.received > 0 && referenceTotal > 0) record.expectedTotal = referenceTotal;
  if (following.received === 0) record.expectedTotal = null;
  const serialized = JSON.stringify(record);
  return {
    ...(paidAmount !== undefined && patch.paidAmount === undefined ? { paidAmount } : {}),
    ...(serialized !== event.clientPaymentRecord ? { clientPaymentRecord: serialized } : {}),
  };
}
