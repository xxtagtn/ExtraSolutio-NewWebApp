function normalized(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const SERVICE_TAB_ALIASES = {
  summary: 'summary',
  resumo: 'summary',
  team: 'team',
  equipa: 'team',
  collaborators: 'team',
  colaboradores: 'team',
  validation: 'validation',
  validacao: 'validation',
  costs: 'costs',
  custos: 'costs',
  history: 'history',
  historico: 'history',
};

const CLIENT_TAB_ALIASES = {
  data: 'data',
  dados: 'data',
  rules: 'rules',
  regras: 'rules',
  commercial: 'rules',
  comerciais: 'rules',
  locations: 'locations',
  locais: 'locations',
  history: 'history',
  historico: 'history',
};

export function serviceDetailTabFromQuery(value) {
  return SERVICE_TAB_ALIASES[normalized(value)] || null;
}

export function clientDetailTabFromQuery(value) {
  return CLIENT_TAB_ALIASES[normalized(value)] || null;
}

export function staffPaymentLinkSelection(assignment, { paymentMonth = '', workDate = '' } = {}) {
  if (!assignment?.id) return null;
  return {
    selectedMonth: paymentMonth || '',
    staffPaymentTab: assignment.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    selectedStaffPaymentIds: [String(assignment.id)],
    staffFilters: {
      eventId: assignment.event?.id ? String(assignment.event.id) : 'all',
      collaboratorId: assignment.collaboratorId ? String(assignment.collaboratorId) : 'all',
      date: workDate || '',
    },
  };
}

export function shouldHandleDeepLink(targetKey, completedKey, loading = false) {
  if (!targetKey || loading) return false;
  return String(targetKey) !== String(completedKey || '');
}
