export const budgetStatusFlow = [
  { id: 'new_request', label: 'Novos Pedidos' },
  { id: 'sent', label: 'Orçamentos Enviados' },
  { id: 'accepted', label: 'Adjudicados' },
  { id: 'lost', label: 'Perdidos' },
];

export const budgetStatusLabels = {
  draft: 'Novo Pedido',
  new_request: 'Novo Pedido',
  analysis: 'Novo Pedido',
  sent: 'Orçamento Enviado',
  accepted: 'Adjudicado',
  rejected: 'Perdido',
  lost: 'Perdido',
};

export function normalizeBudgetStatus(status) {
  if (status === 'draft' || status === 'analysis') return 'new_request';
  if (status === 'rejected') return 'lost';
  return status || 'new_request';
}
