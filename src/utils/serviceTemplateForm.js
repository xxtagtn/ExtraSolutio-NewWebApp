import { decimalValue } from './serviceFinance.js';
import { calculateTravelAmount, normalizeTravelCars } from './travelCalculator.js';

function formatMoneyInline(value) {
  const parsed = decimalValue(value);
  if (parsed === null) return '';
  return `${parsed.toFixed(2).replace('.', ',')}€`;
}

function emptyTravelCar(index = 0) {
  return {
    id: `car-${index + 1}`,
    label: index ? `Carro ${index + 1}` : 'Carro 1',
    km: '',
    kmRate: 0.4,
    durationHours: '',
    travelPeople: 1,
    travelStaffHourlyRate: '',
  };
}

export function parseTemplatePayload(template) {
  if (!template?.payload) return {};
  if (typeof template.payload === 'object') return template.payload;
  try {
    const parsed = JSON.parse(template.payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function travelCarsFromSource(source = {}) {
  const cars = normalizeTravelCars(source.travelCars).map((item, index) => ({
    ...item,
    id: item.id || `car-${index + 1}`,
    label: item.label || `Carro ${index + 1}`,
    km: item.km || '',
    kmRate: item.kmRate || 0.4,
    durationHours: item.durationHours || '',
    travelPeople: item.travelPeople || 1,
    travelStaffHourlyRate: item.travelStaffHourlyRate ? formatMoneyInline(item.travelStaffHourlyRate) : '',
  }));
  if (cars.length) return cars;

  const hasLegacyValues = ['km', 'durationHours', 'travelPeople', 'travelStaffHourlyRate']
    .some((field) => source[field] !== undefined && source[field] !== null && source[field] !== '' && Number(source[field]) !== 0);
  if (hasLegacyValues) {
    return [{
      ...emptyTravelCar(0),
      km: source.km ?? '',
      kmRate: source.kmRate ?? 0.4,
      durationHours: source.durationHours ?? '',
      travelPeople: source.travelPeople ?? 1,
      travelStaffHourlyRate: source.travelStaffHourlyRate ? formatMoneyInline(source.travelStaffHourlyRate) : '',
    }];
  }
  return [emptyTravelCar()];
}

export function cleanTravelCarsForPayload(cars = []) {
  return normalizeTravelCars(cars).map((item, index) => ({
    ...item,
    id: item.id || `car-${index + 1}`,
    label: item.label || `Carro ${index + 1}`,
  }));
}

export function templatePayloadFromForm(currentForm) {
  const calculatedTravelAmount = calculateTravelAmount(currentForm);
  return {
    eventName: currentForm.name || '',
    serviceReference: currentForm.serviceReference || '',
    eventType: currentForm.eventType || '',
    isContinuous: Boolean(currentForm.isContinuous),
    useDefaultLocation: Boolean(currentForm.useDefaultLocation),
    location: currentForm.location || '',
    guestsCount: currentForm.guestsCount || '',
    startTime: currentForm.startTime || '',
    endTime: currentForm.endTime || '',
    uniform: currentForm.uniform || '',
    uniformOther: currentForm.uniformOther || '',
    meetingPoint: currentForm.meetingPoint || '',
    onsiteContactName: currentForm.onsiteContactName || '',
    onsiteContactPhone: currentForm.onsiteContactPhone || '',
    travelExpenseEnabled: calculatedTravelAmount > 0,
    travelExpenseAmount: calculatedTravelAmount,
    travelType: currentForm.travelType || 'none',
    travelPeople: currentForm.travelPeople || 1,
    km: currentForm.km || 0,
    kmRate: currentForm.kmRate || 0.4,
    durationHours: currentForm.durationHours || 0,
    travelStaffHourlyRate: currentForm.travelStaffHourlyRate || '',
    travelCars: cleanTravelCarsForPayload(currentForm.travelCars),
    split5050: Boolean(currentForm.split5050),
    travelManualAmount: currentForm.travelManualAmount || '',
    description: currentForm.description || '',
    workLocationsEnabled: Boolean(currentForm.workLocationsEnabled),
    workLocations: Boolean(currentForm.workLocationsEnabled)
      ? (currentForm.workLocations || [])
        .map((item) => (typeof item === 'string' ? item : item?.name))
        .map((name) => String(name || '').trim())
        .filter(Boolean)
      : [],
    requiredRoles: (currentForm.requiredRoles || []).map((item) => ({
      role: item.role || '',
      qty: Number(item.qty || 0),
      agreedRate: item.agreedRate || '',
    })).filter((item) => item.role && item.qty > 0),
  };
}

export function applyServiceTemplateToForm(previousForm, template, options = {}) {
  const payload = parseTemplatePayload(template);
  const uniformOptions = options.uniformOptions || [];
  const selectedClient = options.selectedClient || null;
  const nextUniform = payload.uniform || '';
  const isKnownUniform = uniformOptions.includes(nextUniform) && nextUniform !== 'Outros';
  const useDefaultLocation = payload.useDefaultLocation !== false;

  return {
    ...previousForm,
    name: payload.eventName || template?.name || '',
    serviceReference: payload.serviceReference || '',
    eventType: payload.eventType || '',
    isContinuous: Boolean(payload.isContinuous),
    endDate: payload.isContinuous ? previousForm.endDate : '',
    useDefaultLocation,
    location: useDefaultLocation
      ? (selectedClient?.address || payload.location || '')
      : (payload.location || ''),
    guestsCount: payload.guestsCount ?? '',
    startTime: payload.startTime || '',
    endTime: payload.endTime || '',
    uniform: isKnownUniform ? nextUniform : (nextUniform ? 'Outros' : ''),
    uniformOther: isKnownUniform ? '' : (payload.uniformOther || nextUniform || ''),
    meetingPoint: payload.meetingPoint || '',
    onsiteContactName: payload.onsiteContactName || '',
    onsiteContactPhone: payload.onsiteContactPhone || '',
    travelExpenseEnabled: Boolean(payload.travelExpenseEnabled),
    travelExpenseAmount: payload.travelExpenseAmount ?? '',
    travelType: payload.travelType || (payload.travelExpenseEnabled ? 'manual' : 'none'),
    travelPeople: payload.travelPeople ?? 1,
    km: payload.km ?? 0,
    kmRate: payload.kmRate ?? 0.4,
    durationHours: payload.durationHours ?? 0,
    travelStaffHourlyRate: payload.travelStaffHourlyRate || '',
    travelCars: travelCarsFromSource(payload),
    split5050: Boolean(payload.split5050),
    travelManualAmount: payload.travelManualAmount ?? payload.travelExpenseAmount ?? '',
    description: payload.description || '',
    workLocationsEnabled: Boolean(payload.workLocationsEnabled),
    workLocations: Boolean(payload.workLocationsEnabled) && Array.isArray(payload.workLocations)
      ? payload.workLocations
        .map((item) => (typeof item === 'string' ? item : item?.name))
        .map((name) => String(name || '').trim())
        .filter(Boolean)
      : [],
    requiredRoles: Array.isArray(payload.requiredRoles)
      ? payload.requiredRoles.map((item) => ({
        role: item.role || '',
        qty: Number(item.qty || 0),
        agreedRate: item.agreedRate || '',
      })).filter((item) => item.role && item.qty > 0)
      : [],
    assignments: [],
  };
}
