export const STAFF_PAYMENT_WORKFLOW_TABS = [
  { id: 'unpaid', label: 'Colaboradores por Pagar' },
  { id: 'awaiting_validation', label: 'Aguardar Validação' },
  { id: 'validated_es', label: 'Validado ES' },
  { id: 'awaiting_data', label: 'Aguardar RV' },
  { id: 'paid', label: 'Colaboradores Pagos' },
];

function normalized(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function staffPaymentWorkflowTab(assignment) {
  const paymentStatus = normalized(assignment?.paymentStatus) || 'unpaid';
  if (paymentStatus === 'paid') return 'paid';
  if (paymentStatus === 'validated_es') return 'validated_es';
  if (paymentStatus === 'awaiting_data') return 'awaiting_data';
  if (assignment?._financeReady === false) return 'awaiting_validation';
  return 'unpaid';
}

export function staffPaymentSearchMatches(assignment, search) {
  const query = normalized(search);
  if (!query) return true;

  return [
    assignment?.collaborator?.shortName,
    assignment?.collaborator?.name,
    assignment?.collaborator?.nif,
  ].some((value) => normalized(value).includes(query));
}
