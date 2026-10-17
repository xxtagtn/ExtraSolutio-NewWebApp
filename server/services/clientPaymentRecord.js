import { randomUUID } from 'node:crypto';
import { clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { clientPaymentAdjustment, paymentFinancialSnapshot } from '../../src/utils/clientPaymentAdjustment.js';
import { receiptFiscal, reconcileReceiptRounding } from '../../src/utils/clientReceiptTax.js';
import { receiptMovements } from '../../src/utils/clientReceiptMovements.js';

const cents = (value) => Math.round(Number(value || 0) * 100);
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;

export function clientPaymentRecordPatch(event, patch = {}, { type, now = new Date(), legacyInvoiced = false, allocations, actor, description } = {}) {
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
  const author = actor ? { id: actor.id, name: String(actor.name || '').slice(0, 150) } : null;
  if (legacyInvoiced) record.legacyInvoiced = true;
  // An old record can only be enriched while its recorded total is still fully covered.
  if (!record.settledFinancials && previous.total > 0 && previous.received === previous.total) {
    const snapshot = paymentFinancialSnapshot(event);
    if (snapshot) record.settledFinancials = snapshot;
  }
  const append = (entryType, amount, receivedAt, source) => {
    const salesSnapshot = source === 'recorded' && amount > 0 ? paymentFinancialSnapshot(next) : null;
    record.entries.push({ id: randomUUID(), type: entryType, amount, receivedAt: day(receivedAt), source, recordedAt: now.toISOString(),
      ...(source === 'recorded' && author ? { actor: author } : {}),
      ...(source === 'recorded' && description ? { description } : {}),
      ...(salesSnapshot ? { salesSnapshot, fiscal: receiptFiscal(salesSnapshot, amount) } : {}) });
  };
  if (!currentRecord && previous.received > 0) {
    const initialSignal = Math.min(previous.signal, previous.received);
    if (initialSignal > 0) append('signal', initialSignal, event.signaledAt, 'legacy');
    if (previous.received > initialSignal) append('remaining', Number((previous.received - initialSignal).toFixed(2)), event.billingPaymentDate, 'legacy');
    if (event.billingStatus === 'paid') record.expectedTotal = previous.total;
  }
  const delta = cents(following.received) - cents(previous.received);
  const signalChanged = cents(next.signaledAmount) !== cents(event.signaledAmount) || day(next.signaledAt) !== day(event.signaledAt);
  if (currentRecord?.entries.some((entry) => entry.operation) && type !== 'reversal'
    && !(delta > 0 && previous.received === 0)
    && (signalChanged || delta < 0 || (!delta && day(next.billingPaymentDate) !== day(event.billingPaymentDate)))) {
    throw Object.assign(new Error('Corrige este recebimento individualmente no respetivo menu de ações.'), { statusCode: 422, expose: true });
  }
  const projection = receiptMovements(record);
  const onlySignal = projection.reliable && projection.rows.filter((row) => !row.voided).length === 1
    ? projection.rows.find((row) => !row.voided && row.type === 'signal') : null;
  const correctSignal = onlySignal && signalChanged && previous.received === previous.signal && following.received === following.signal && following.signal > 0;
  if (correctSignal) {
    record.entries.push({ id: randomUUID(), type: 'correction', operation: 'edit', targetId: onlySignal.id,
      ...(author ? { actor: author } : {}),
      amount: delta / 100, recordedAt: now.toISOString(), before: { ...onlySignal },
      replacement: { amount: following.signal, type: 'signal', receivedAt: day(next.signaledAt), description: onlySignal.description || '',
        fiscal: receiptFiscal(onlySignal.salesSnapshot, following.signal), salesSnapshot: onlySignal.salesSnapshot || null } });
  } else if (delta) {
    const entryType = delta < 0 ? type || 'correction' : type || (previous.received === 0 ? 'signal'
      : previous.remainingReceived === 0 ? 'remaining' : 'adjustment');
    append(entryType, delta / 100, entryType === 'signal' ? next.signaledAt : next.billingPaymentDate, 'recorded');
    if (entryType === 'adjustment' && delta > 0) {
      const breakdown = clientPaymentAdjustment({ ...event, clientPaymentRecord: record }, previous.received);
      if (breakdown?.available) record.entries.at(-1).financialAdjustment = breakdown;
      if (breakdown?.available && !breakdown.receivedTowards && cents(breakdown.total) === delta) {
        record.entries.at(-1).fiscal = { base: breakdown.base, tax: breakdown.tax, total: breakdown.total, method: 'adjustment' };
      }
    }
  }
  if (allocations !== undefined) {
    const entry = record.entries.at(-1);
    const fiscal = Array.isArray(allocations) && allocations.length && delta > 0 && !correctSignal
      ? receiptFiscal(entry.salesSnapshot, delta / 100, allocations) : null;
    if (!fiscal) throw Object.assign(new Error('A distribuição pelos componentes deve corresponder exatamente ao novo recebimento.'), { statusCode: 422, expose: true });
    entry.fiscal = fiscal;
  }
  if (delta > 0 && !correctSignal) {
    const entry = record.entries.at(-1);
    entry.fiscal = reconcileReceiptRounding(entry.salesSnapshot, entry.fiscal,
      receiptMovements({ ...record, entries: record.entries.slice(0, -1) }).rows.filter((row) => !row.voided));
  }
  const referenceTotal = previous.received === 0 ? following.total : previous.total;
  if (record.expectedTotal == null && following.received > 0 && referenceTotal > 0) record.expectedTotal = referenceTotal;
  if (following.received === 0) { record.expectedTotal = null; delete record.settledFinancials; }
  else if (following.total > 0 && following.received === following.total) {
    const snapshot = paymentFinancialSnapshot(next);
    if (snapshot) record.settledFinancials = snapshot;
  }
  const serialized = JSON.stringify(record);
  return {
    ...(paidAmount !== undefined && patch.paidAmount === undefined ? { paidAmount } : {}),
    ...(serialized !== event.clientPaymentRecord ? { clientPaymentRecord: serialized } : {}),
  };
}
