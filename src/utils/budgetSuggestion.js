const serviceTypeLabels = {
  buffet: 'Buffet',
  empratado: 'Empratado',
  volante: 'Volante',
  cocktail: 'Cocktail',
  coffee_break: 'Coffee Break',
  welcome_drink: 'Welcome Drink',
  cocktail_volante: 'Cocktail Volante',
  jantar_gala: 'Jantar Gala / Servi\u00e7o Premium',
  bar_simples: 'Bar Simples',
  bar_cocktails: 'Bar de Cocktails',
  bbq: 'Churrasco / BBQ',
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
  'Barman de Apoio': 13,
  'Chefe de Sala': 18,
  Cozinheiro: 16,
  Churrasqueiro: 16,
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

function roleRatio(role, ratio, pax, startTime, endTime, roleRates) {
  return buildCategory(role, Math.max(1, Math.ceil(pax / ratio)), startTime, endTime, roleRates);
}

function fixedCategory(role, qty, startTime, endTime, roleRates) {
  return buildCategory(role, qty, startTime, endTime, roleRates);
}

function copaQuantity(pax) {
  if (pax <= 80) return 1;
  if (pax <= 180) return 2;
  if (pax <= 300) return 3;
  if (pax <= 450) return 4;
  return 4 + Math.ceil((pax - 450) / 120);
}

function logistaQuantity(pax) {
  if (pax <= 50) return 1;
  if (pax <= 100) return 2;
  if (pax <= 150) return 3;
  if (pax <= 200) return 4;
  return 4 + Math.ceil((pax - 200) / 50);
}

export function getBudgetSmartSuggestion(form = {}, options = {}) {
  const pax = suggestionGuestCount(form);
  const day = firstFilledDay(form);
  const startTime = day.startTime || form.startTime || '';
  const endTime = day.endTime || form.endTime || '';
  const roleRates = options.roleRates || defaultRoleRates;

  if (!pax) return null;

  const serviceType = form.serviceType || 'buffet';
  const categories = [];
  const addRatio = (role, ratio) => categories.push(roleRatio(role, ratio, pax, startTime, endTime, roleRates));
  const addFixed = (role, qty) => categories.push(fixedCategory(role, qty, startTime, endTime, roleRates));

  switch (serviceType) {
    case 'coffee_break':
      addRatio('Emp.Mesa', 20);
      addFixed('Copa Fina', copaQuantity(pax));
      break;
    case 'welcome_drink':
      addRatio('Emp.Mesa', 20);
      break;
    case 'cocktail_volante':
      addRatio('Emp.Mesa', 15);
      break;
    case 'empratado':
      addRatio('Emp.Mesa', 12);
      addFixed('Copa Fina', copaQuantity(pax));
      break;
    case 'jantar_gala':
      addRatio('Emp.Mesa', 10);
      break;
    case 'bar_simples':
      addRatio('Barman', 40);
      break;
    case 'bar_cocktails': {
      const barmanCount = Math.max(1, Math.ceil(pax / 20));
      addFixed('Barman', barmanCount);
      if (barmanCount >= 3) addFixed('Barman de Apoio', 1);
      break;
    }
    case 'bbq':
      addFixed('Churrasqueiro', 1);
      addFixed('Ajd.Cozinha', 1);
      break;
    case 'volante':
      addRatio('Emp.Mesa', 24);
      addFixed('Copa Fina', copaQuantity(pax));
      break;
    case 'trinchar':
      addRatio('Emp.Mesa', 25);
      addRatio('Cozinheiro', 80);
      break;
    case 'cocktail':
      // Preserve the legacy Cocktail behaviour for existing budgets.
      addRatio('Emp.Mesa', 28);
      addRatio('Barman', 45);
      addFixed('Copa Fina', copaQuantity(pax));
      break;
    case 'buffet':
    default:
      addRatio('Emp.Mesa', 20);
      addFixed('Copa Fina', copaQuantity(pax));
      break;
  }

  const noAutomaticLogista = new Set([
    'coffee_break',
    'welcome_drink',
    'cocktail_volante',
    'buffet',
    'volante',
    'bar_simples',
    'bar_cocktails',
  ]);
  const logistaRequiredByService = ['empratado', 'jantar_gala', 'trinchar'].includes(serviceType);
  const logistaRequiredByLevel = form.eventLevel === 'premium' && !noAutomaticLogista.has(serviceType);
  if (logistaRequiredByService || logistaRequiredByLevel) {
    addFixed('Logista', logistaQuantity(pax));
  }

  const staffBeforeChef = categories.reduce((total, item) => total + Number(item.qty || 0), 0);
  if ((staffBeforeChef > 10 || form.eventLevel === 'institutional' || form.eventLevel === 'premium') && !categories.some((item) => item.role === 'Chefe de Sala')) {
    categories.push(fixedCategory('Chefe de Sala', 1, startTime, endTime, roleRates));
  }

  return {
    categories,
    travelType: form.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none',
    notes: `Sugest\u00e3o autom\u00e1tica para ${pax} convidados, servi\u00e7o ${serviceTypeLabels[serviceType] || 'Buffet'} e n\u00edvel ${eventLevelLabels[form.eventLevel] || 'Normal'}.`,
  };
}
