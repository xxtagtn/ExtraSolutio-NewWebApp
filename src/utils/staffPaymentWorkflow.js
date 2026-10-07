export const STAFF_PAYMENT_WORKFLOW_TABS = [
  { id: 'unpaid', label: 'Colaboradores por Pagar', countBy: 'collaborators' },
  { id: 'awaiting_validation', label: 'Aguardar Validação', countBy: 'services' },
  { id: 'validated_es', label: 'Validado ES', countBy: 'services' },
  { id: 'awaiting_data', label: 'Aguardar RV', countBy: 'services' },
  { id: 'penhorado', label: 'Penhorado', countBy: 'services' },
  { id: 'ganho', label: 'Ganho', countBy: 'services' },
  { id: 'paid', label: 'Colaboradores Pagos', countBy: 'collaborators' },
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
  if (paymentStatus === 'penhorado') return 'penhorado';
  if (paymentStatus === 'ganho') return 'ganho';
  if (assignment?._financeReady === false) return 'awaiting_validation';
  return 'unpaid';
}

export function countStaffPaymentTabs(assignments, tabs) {
  const counts = Object.fromEntries(tabs.map((tab) => [tab.id, 0]));
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const collaboratorIdsByTab = new Map();

  for (const assignment of assignments) {
    const tabId = staffPaymentWorkflowTab(assignment);
    const tab = tabsById.get(tabId);
    if (tab) {
      if (tab.countBy === 'collaborators') {
        const sourceId = assignment?.collaboratorId;
        const collaboratorId = sourceId === null || sourceId === undefined || sourceId === ''
          ? assignment?.collaborator?.id
          : sourceId;
        if (collaboratorId !== null && collaboratorId !== undefined && collaboratorId !== '') {
          const ids = collaboratorIdsByTab.get(tabId) || new Set();
          ids.add(String(collaboratorId));
          collaboratorIdsByTab.set(tabId, ids);
        }
      } else {
        counts[tabId] += 1;
      }
    }

    if (tabsById.has('all')) counts.all += 1;
  }

  for (const [tabId, collaboratorIds] of collaboratorIdsByTab) {
    counts[tabId] = collaboratorIds.size;
  }

  return counts;
}

export function sumStaffPaymentTabs(assignments, tabs, amountForAssignment) {
  const cents = Object.fromEntries(tabs.map((tab) => [tab.id, 0]));
  for (const assignment of assignments) {
    const amount = amountForAssignment(assignment);
    const rowCents = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    const tabId = staffPaymentWorkflowTab(assignment);
    if (Object.hasOwn(cents, tabId)) cents[tabId] += rowCents;
    if (Object.hasOwn(cents, 'all')) cents.all += rowCents;
  }
  return Object.fromEntries(Object.entries(cents).map(([tabId, total]) => [tabId, total / 100]));
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

export function staffPaymentFiltersMatch(assignment, filters = {}) {
  return (filters.eventId === 'all' || String(assignment?.event?.id) === String(filters.eventId))
    && (filters.collaboratorId === 'all' || String(assignment?.collaboratorId) === String(filters.collaboratorId));
}
