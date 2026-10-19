import { buildClientFinanceSnapshot } from '../../src/utils/clientFinanceSnapshot.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { withGroupedServiceInvoices } from './invoiceBilling.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { clientPaymentTax } from '../../src/utils/clientPaymentTotal.js';

const cents = (value) => Math.round(Number(value) * 100);
function fail(message, statusCode = 422) { throw Object.assign(new Error(message), { statusCode, expose: true }); }

export async function updateClientFinancialMetadata(db, eventId, input, actor = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0 || !['archive', 'restore', 'allocate'].includes(input.action)) fail('Operação financeira inválida.');
  try {
    const transact = (callback) => typeof db.$transaction === 'function'
      ? db.$transaction(callback, { isolationLevel: 'Serializable' }) : callback(db);
    return await transact(async (tx) => {
      const loaded = await tx.event.findUnique({ where: { id }, include: serviceListInclude });
      if (!loaded) return null;
      const [event] = await withGroupedServiceInvoices(tx, [loaded]);
      const original = readClientPaymentRecord(event.clientPaymentRecord);
      if (event.clientPaymentRecord && !original) fail('O histórico financeiro não é válido. Confirma os dados antes de continuar.');
      if (!input.updatedAt || new Date(input.updatedAt).getTime() !== event.updatedAt.getTime()
        || input.revision !== (original?.entries.length || 0)) fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
      const snapshot = buildClientFinanceSnapshot(event);
      const initialized = original ? {} : clientPaymentRecordPatch(event);
      const record = globalThis.structuredClone(original || readClientPaymentRecord(initialized.clientPaymentRecord) || { version: 1, entries: [] });
      const at = new Date().toISOString(), author = { id: actor.id, name: String(actor.name || '').slice(0, 150) };
      if (snapshot.archive.legacy) record.financeArchive = { archivedAt: at, confirmedTotal: snapshot.payment.total, legacy: true };
      record.financeWorkflowVersion = 2;
      if (input.action === 'archive') {
        if (!snapshot.archive.canArchive) fail(snapshot.archive.blocker);
        if (snapshot.allocationRequired) fail('Confirma a repartição da faturação e dos recebimentos por período antes de arquivar.');
        if (cents(input.confirmedTotal) !== cents(snapshot.payment.total) || cents(input.confirmedReceived) !== cents(snapshot.payment.received)) fail('Confirma os valores atuais antes de arquivar.', 409);
        if (snapshot.archive.archived) return event;
        record.financeArchive = { archivedAt: at, confirmedTotal: snapshot.payment.total, confirmedReceived: snapshot.payment.received,
          receiptRevision: record.entries.length, actor: author };
      } else if (input.action === 'restore') {
        record.financeArchive = { ...(record.financeArchive || {}), archivedAt: null, restoredAt: at, actor: author };
      } else {
        if (snapshot.periods.length < 2 || !Array.isArray(input.periods) || input.periods.length !== snapshot.periods.length) fail('Confirma todos os períodos deste serviço.');
        const keys = new Set();
        const rows = input.periods.map((row) => {
          const period = snapshot.periods.find((item) => item.key === row.key);
          if (!period || keys.has(row.key)) fail('Os períodos não correspondem ao serviço atual.');
          keys.add(row.key);
          const values = ['globalTotal', 'globalTax', 'received'].map((field) => Number(row[field]));
          if (values.some((value) => !Number.isFinite(value) || value < 0) || cents(values[1]) > cents(values[0])) fail('Indica valores monetários válidos para cada período.');
          if (cents(values[2]) > cents(period.staffBase) + cents(period.staffTax) + cents(values[0])) fail('O recebido atribuído ao período não pode exceder o seu valor.');
          return { key: row.key, globalTotal: cents(values[0]) / 100, globalTax: cents(values[1]) / 100, received: cents(values[2]) / 100 };
        });
        const sum = (field) => rows.reduce((total, row) => total + cents(row[field]), 0);
        if (sum('globalTotal') !== cents(snapshot.unassignedTotal) || sum('globalTax') !== cents(snapshot.unassignedTax)
          || sum('received') !== cents(snapshot.payment.received)) fail('A soma da repartição deve corresponder exatamente aos valores globais, IVA e recebimentos existentes.');
        record.billingAllocation = { total: snapshot.payment.total, tax: clientPaymentTax(event), receivedTotal: snapshot.payment.received, basis: snapshot.allocationBasis,
          receiptRevision: record.entries.length, periods: rows, recordedAt: at, actor: author };
      }
      record.financeChanges = [...(record.financeChanges || []), { action: input.action, recordedAt: at, actor: author,
        total: snapshot.payment.total, received: snapshot.payment.received, ...(input.action === 'allocate' ? { before: original?.billingAllocation || null, allocation: record.billingAllocation } : {}) }];
      const updated = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt, clientPaymentRecord: event.clientPaymentRecord }, data: { ...initialized, clientPaymentRecord: JSON.stringify(record) } });
      if (updated.count !== 1) fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    });
  } catch (error) {
    if (error.code === 'P2034') fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
    throw error;
  }
}
