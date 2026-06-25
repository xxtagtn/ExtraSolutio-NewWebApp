import { decimalValue } from './serviceFinance.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

export function calculateTravelAmount(input = {}) {
  switch (input.travelType) {
    case 'outside_lisbon':
      return 35;
    case 'outside_plus_staff':
      return Number((35 + (numberValue(input.travelPeople) * 10)).toFixed(2));
    case 'kilometers': {
      const kilometerAmount = numberValue(input.km) * numberValue(input.kmRate);
      const hasManualStaffRate = Object.prototype.hasOwnProperty.call(input, 'travelStaffHourlyRate');
      const staffHourlyRate = hasManualStaffRate ? numberValue(input.travelStaffHourlyRate) : 10;
      const timeAmount = numberValue(input.durationHours) * numberValue(input.travelPeople) * staffHourlyRate;
      return Number((kilometerAmount + (input.split5050 ? timeAmount / 2 : timeAmount)).toFixed(2));
    }
    case 'manual':
      return Number(numberValue(input.travelManualAmount).toFixed(2));
    default:
      return 0;
  }
}
