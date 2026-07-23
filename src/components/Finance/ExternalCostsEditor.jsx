import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_EXTERNAL_COST_VAT_TYPE,
  EXTERNAL_COST_TYPE_OPTIONS,
  EXTERNAL_COST_VAT_OPTIONS,
  createEmptyExternalCost,
  normalizeExternalCosts,
} from '../../utils/externalCosts.js';
import { money } from '../../utils/formatters.js';

export default function ExternalCostsEditor({
  value = [],
  onChange,
  keepAtLeastOne = false,
}) {
  const costs = Array.isArray(value) ? value : [];

  function updateCost(index, patch) {
    onChange(costs.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  }

  function addCost() {
    onChange([...costs, createEmptyExternalCost()]);
  }

  function removeCost(index) {
    const next = costs.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length || !keepAtLeastOne ? next : [createEmptyExternalCost()]);
  }

  return (
    <div className="external-costs-editor">
      <div className="budget-category-actions">
        <button className="secondary-button" type="button" onClick={addCost}>
          <Plus size={15} />
          Adicionar custo externo
        </button>
      </div>

      {costs.map((item, index) => {
        const calculated = normalizeExternalCosts([item])[0] || {};
        return (
          <div className="budget-category" key={item.id || index}>
            <header>
              <strong>Custo externo {index + 1}</strong>
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={() => removeCost(index)}
                aria-label={`Remover custo externo ${index + 1}`}
              >
                <Trash2 size={15} />
              </button>
            </header>
            <div className="budget-category-grid budget-external-grid">
              <label>Tipo
                <select value={item.type || ''} onChange={(event) => updateCost(index, { type: event.target.value })}>
                  <option value="">Selecionar</option>
                  {EXTERNAL_COST_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>Fornecedor
                <input value={item.supplier || ''} onChange={(event) => updateCost(index, { supplier: event.target.value })} />
              </label>
              <label>Custo parceiro
                <input type="number" min="0" step="any" value={item.costAmount || ''} onChange={(event) => updateCost(index, { costAmount: event.target.value })} />
              </label>
              <label>Margem %
                <input type="number" min="0" step="any" value={item.marginPercent || ''} onChange={(event) => updateCost(index, { marginPercent: event.target.value })} />
              </label>
              <label>IVA
                <select
                  value={item.vatType || DEFAULT_EXTERNAL_COST_VAT_TYPE}
                  onChange={(event) => updateCost(index, { vatType: event.target.value })}
                >
                  {EXTERNAL_COST_VAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="budget-external-result">
                <span>Valor cliente</span>
                <strong>{money.format(calculated.chargeAmount || 0)}</strong>
                <small>Margem: {money.format(calculated.marginAmount || 0)}</small>
                <small>IVA: {money.format(calculated.taxAmount || 0)}</small>
              </div>
              <label className="span-2">Descrição
                <input value={item.description || ''} onChange={(event) => updateCost(index, { description: event.target.value })} />
              </label>
            </div>
          </div>
        );
      })}

      {!costs.length ? (
        <div className="budget-empty-staff">
          <strong>Sem custos externos registados</strong>
          <span>Adiciona aqui parceiros, catering, bebidas, material, aluguer ou transporte.</span>
        </div>
      ) : null}
    </div>
  );
}
