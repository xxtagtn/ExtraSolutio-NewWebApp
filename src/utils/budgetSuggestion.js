const serviceTypeLabels = {
  buffet: 'Buffet',
  empratado: 'Empratado',
  volante: 'Volante',
  cocktail: 'Cocktail',
  coffee_break: 'Coffee Break',
  trinchar: 'Trinchar',
};

const eventLevelLabels = {
  normal: 'Normal',
  institutional: 'Institucional',
  premium: 'Premium',
};

const defaultRoleRates = {
  'Emp.Mesa': 12,
  'Copa Fina': 11,
  Barman: 14,
  'Chefe de Sala': 18,
  Cozinheiro: 16,
  'Ajd.Cozinha': 12,
  Logista: 13,
};

function numeric(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstFilledDay(form = {}) {
  return (form.eventDays || []).find((day) => (
    numeric(day?.guestsCount) > 0 || day?.startTime || day?.endTime
  )) || (form.eventDays || [])[0] || {};
}

function suggestionGuestCount(form = {}) {
  const dayCounts = (form.eventDays || []).map((day) => numeric(day?.guestsCount));
  return Math.max(numeric(form.guestsCount), ...dayCounts, 0);
}

function buildCategory(role, qty, start, end, roleRates) {
  return {
    role,
    qty,
    date: '',
    start,
    end,
    uniform: '',
    rate: roleRates[role] || 12,
  };
}

export function getBudgetSmartSuggestion(form = {}, options = {}) {
  const pax = suggestionGuestCount(form);
  const day = firstFilledDay(form);
  const startTime = day.startTime || form.startTime || '';
  const endTime = day.endTime || form.endTime || '';
  const roleRates = options.roleRates || defaultRoleRates;

  if (!pax) return null;

  const ratios = {
    buffet: { 'Emp.Mesa': 25, 'Copa Fina': 55 },
    empratado: { 'Emp.Mesa': 12, 'Copa Fina': 45 },
    volante: { 'Emp.Mesa': 24, 'Copa Fina': 55 },
    cocktail: { 'Emp.Mesa': 28, Barman: 45, 'Copa Fina': 60 },
    coffee_break: { 'Emp.Mesa': 35, 'Copa Fina': 70 },
    trinchar: { 'Emp.Mesa': 25, Cozinheiro: 80 },
  };
  const selected = ratios[form.serviceType] || ratios.buffet;
  const categories = Object.entries(selected).map(([role, ratio]) => (
    buildCategory(role, Math.max(1, Math.ceil(pax / ratio)), startTime, endTime, roleRates)
  ));

  if ((form.eventLevel === 'institutional' || form.eventLevel === 'premium') && !categories.some((item) => item.role === 'Chefe de Sala')) {
    categories.push(buildCategory('Chefe de Sala', 1, startTime, endTime, roleRates));
  }

  return {
    categories,
    travelType: form.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none',
    notes: `Sugestão automática para ${pax} convidados, serviço ${serviceTypeLabels[form.serviceType] || 'Buffet'} e nível ${eventLevelLabels[form.eventLevel] || 'Normal'}.`,
  };
}
