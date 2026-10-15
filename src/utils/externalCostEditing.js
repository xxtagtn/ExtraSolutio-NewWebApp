import { EXTERNAL_COST_VAT_OPTIONS, normalizeExternalCosts } from './externalCosts.js';
import { decimalValue } from './serviceFinance.js';

function externalCostError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

export function externalCostRowsForEditing(value) {
  let rows = value == null || value === '' ? [] : value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch { throw externalCostError('Os custos externos guardados têm um formato inválido. Não foram alterados.'); }
  }
  if (!Array.isArray(rows)) throw externalCostError('Os custos externos guardados não são uma lista válida.');
  const seen = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw externalCostError('Existe um custo externo inválido. Confirma os dados antes de editar.');
    const id = String(row.id || '').trim() || `external-${index + 1}`;
    if (seen.has(id)) throw externalCostError('Existem custos externos com o mesmo identificador. Confirma os dados antes de editar.', 409);
    seen.add(id);
    return { ...row, id };
  });
}

export function validateExternalCostDraft(draft) {
  if (!String(draft.type || '').trim()) throw externalCostError('Seleciona o tipo de custo externo.');
  if (!String(draft.supplier || '').trim() && !String(draft.description || '').trim()) {
    throw externalCostError('Indica o fornecedor ou uma descrição do serviço.');
  }
  const amount = decimalValue(draft.costAmount);
  if (amount === null || amount < 0) throw externalCostError('Indica um custo do parceiro válido, igual ou superior a zero.');
  const margin = draft.marginPercent === '' || draft.marginPercent == null ? 0 : decimalValue(draft.marginPercent);
  if (margin === null || margin < 0) throw externalCostError('Indica uma margem válida, igual ou superior a zero.');
  if (!EXTERNAL_COST_VAT_OPTIONS.some((option) => option.value === draft.vatType)) throw externalCostError('Seleciona uma opção de IVA válida.');
  const normalized = normalizeExternalCosts([{ ...draft, costAmount: amount, marginPercent: margin }])[0];
  if (Object.values(normalized).some((value) => typeof value === 'number' && !Number.isFinite(value))) {
    throw externalCostError('Os valores indicados excedem o limite permitido para o custo externo.');
  }
  return normalized;
}

export function applyExternalCostChange(value, draft, { costId = null } = {}) {
  const rows = externalCostRowsForEditing(value);
  const id = String(costId ?? draft.id ?? '').trim();
  if (!id || id.length > 200) throw externalCostError('O custo externo precisa de um identificador válido.');
  if (costId != null && draft.id != null && String(draft.id) !== id) throw externalCostError('Não é possível alterar o identificador do custo externo.');
  const index = rows.findIndex((row) => row.id === id);
  if (costId != null && index < 0) throw externalCostError('O custo externo já não pertence a este evento. Atualiza a página.', 404);
  const original = index >= 0 ? rows[index] : null;
  const normalized = validateExternalCostDraft({ ...(costId != null ? original : {}), ...draft, id,
    status: original?.status || 'pending' });
  const same = original && JSON.stringify(normalizeExternalCosts([original])[0]) === JSON.stringify(normalized);
  if (index >= 0 && costId == null && !same) throw externalCostError('Já existe outro custo com este identificador. Atualiza a página.', 409);
  if (same) return { rows, unchanged: true };
  if (index < 0) rows.push(normalized);
  else rows[index] = { ...original, ...normalized };
  return { rows, unchanged: false };
}

export function removeExternalCost(value, costId) {
  const rows = externalCostRowsForEditing(value);
  const id = String(costId || '').trim();
  if (!id || !rows.some((row) => row.id === id)) {
    throw externalCostError('O custo externo já não pertence a este evento. Atualiza a página.', 404);
  }
  return { rows: rows.filter((row) => row.id !== id), unchanged: false };
}
