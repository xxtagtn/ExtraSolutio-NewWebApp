import { decimalValue } from './serviceFinance.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

function parseTravelCars(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeTravelCars(value) {
  return parseTravelCars(value)
    .filter((item) => item?.kind !== 'staff_compensation')
    .map((item, index) => ({
      id: String(item?.id || `car-${index + 1}`),
      label: String(item?.label || item?.name || '').trim(),
      km: numberValue(item?.km),
      kmRate: numberValue(item?.kmRate),
      durationHours: numberValue(item?.durationHours),
      travelPeople: numberValue(item?.travelPeople),
      travelStaffHourlyRate: numberValue(item?.travelStaffHourlyRate),
    }))
    .filter((item) => (
      item.km > 0
      || item.durationHours > 0
      || item.travelStaffHourlyRate > 0
    ));
}

export function calculateTravelCarAmount(car = {}, split5050 = false) {
  const kilometerAmount = numberValue(car.km) * numberValue(car.kmRate);
  const timeAmount = numberValue(car.durationHours)
    * numberValue(car.travelPeople)
    * numberValue(car.travelStaffHourlyRate);
  return Number((kilometerAmount + (split5050 ? timeAmount / 2 : timeAmount)).toFixed(2));
}

export function calculateTravelAmount(input = {}) {
  switch (input.travelType) {
    case 'outside_lisbon':
      return 35;
    case 'outside_plus_staff':
      return Number((35 + (numberValue(input.travelPeople) * 10)).toFixed(2));
    case 'kilometers': {
      const cars = normalizeTravelCars(input.travelCars);
      if (cars.length) {
        return Number(cars.reduce((sum, car) => sum + calculateTravelCarAmount(car, Boolean(input.split5050)), 0).toFixed(2));
      }
      return calculateTravelCarAmount({
        km: input.km,
        kmRate: input.kmRate,
        durationHours: input.durationHours,
        travelPeople: input.travelPeople,
        travelStaffHourlyRate: input.travelStaffHourlyRate,
      }, Boolean(input.split5050));
    }
    case 'manual':
      return Number(numberValue(input.travelManualAmount).toFixed(2));
    default:
      return 0;
  }
}

export function travelSaleBreakdown(event = {}, total = 0) {
  if (!event.travelExpenseEnabled || total === 0) return { kilometers: 0, time: 0, other: total };
  if (event.travelType !== 'kilometers') return { kilometers: 0, time: 0, other: total };
  const cars = normalizeTravelCars(event.travelCars);
  const sources = cars.length ? cars : [event];
  const kilometers = Number(sources.reduce((sum, car) => sum + numberValue(car.km) * numberValue(car.kmRate), 0).toFixed(2));
  const calculated = calculateTravelAmount(event);
  if (Math.round(calculated * 100) !== Math.round(total * 100)) return { kilometers: 0, time: 0, other: total };
  return { kilometers, time: Number((calculated - kilometers).toFixed(2)), other: 0 };
}
