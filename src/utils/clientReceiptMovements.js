import { readClientPaymentRecord } from './clientPaymentRecord.js';

export const receiptTypeLabels = { signal: 'Sinalização', remaining: 'Restante recebido', adjustment: 'Acerto final' };
const cents = (value) => Math.round(Number(value || 0) * 100);

// Old entries are deltas. Linked corrections project their current movement without rewriting the journal.
export function receiptMovements(recordValue) {
  const record = readClientPaymentRecord(recordValue), movements = new Map();
  let reliable = Boolean(record);
  for (const entry of record?.entries || []) {
    if (entry.operation) {
      const original = movements.get(entry.targetId);
      if (original?.voided === 'reverse' && entry.operation === 'delete' && cents(entry.amount) === 0) {
        movements.set(entry.targetId, { ...original, voided: 'delete', deletedAt: entry.recordedAt, lastCorrection: entry.id });
        continue;
      }
      if (!original || original.voided) { reliable = false; continue; }
      if (entry.operation === 'edit') {
        if (cents(entry.amount) !== cents(entry.replacement?.amount) - cents(original.amount)) { reliable = false; continue; }
        movements.set(entry.targetId, { ...original, ...entry.replacement, id: original.id, lastCorrection: entry.id,
          financialAdjustment: cents(entry.replacement.amount) === cents(original.amount) ? original.financialAdjustment : null });
      } else if (['reverse', 'delete'].includes(entry.operation) && cents(entry.amount) === -cents(original.amount)) {
        movements.set(entry.targetId, { ...original, voided: entry.operation, voidedAt: entry.recordedAt, lastCorrection: entry.id });
      } else reliable = false;
    } else if (cents(entry.amount) > 0 && Object.hasOwn(receiptTypeLabels, entry.type)) {
      if (movements.has(entry.id)) reliable = false;
      movements.set(entry.id, { ...entry });
    } else if (cents(entry.amount) < 0) {
      const active = [...movements.values()].filter((row) => !row.voided);
      const total = active.reduce((sum, row) => sum + cents(row.amount), 0);
      if (entry.type === 'reversal' && -cents(entry.amount) === total) {
        for (const row of active) movements.set(row.id, { ...row, voided: 'reverse', voidedAt: entry.recordedAt });
      } else reliable = false;
    }
  }
  const rows = [...movements.values()];
  const total = rows.filter((row) => !row.voided).reduce((sum, row) => sum + cents(row.amount), 0);
  const journalTotal = (record?.entries || []).reduce((sum, entry) => sum + cents(entry.amount), 0);
  return { rows, reliable: reliable && total === journalTotal, total: total / 100 };
}

export function receiptCanDelete(record, row) {
  // Delete is an audited tombstone, never physical journal removal. Issued invoices are checked on the server.
  return Boolean(row && (!row.voided || row.voided === 'reverse') && cents(row.amount) > 0 && (!record || receiptMovements(record).reliable));
}
