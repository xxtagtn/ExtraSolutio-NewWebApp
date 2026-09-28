import { staffTravelCompensation } from '../utils/staffTravel.js';
import { staffAssignmentPaymentTotal } from '../utils/staffPayment.js';
import './Finance/staffTravel.css';

const number = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });

export default function StaffTravelSummary({ assignment, event = assignment.event, total = false, compact = false }) {
  const travel = staffTravelCompensation(assignment, event);
  if (!travel.payableHours) return null;
  const showAmount = assignment.hourlyRate !== null && assignment.hourlyRate !== undefined;
  if (compact === 'inline') return <div className="staff-travel-summary staff-travel-summary--compact staff-travel-summary--inline">
    <small
      aria-label={`Deslocação: ${number.format(travel.payableHours)}h${showAmount ? ` · ${money.format(travel.amount)}` : ''}`}
      title={`Deslocação: ${number.format(travel.payableHours)}h${showAmount ? ` · ${money.format(travel.amount)}` : ''}`}
    >
      Desloc. {number.format(travel.payableHours)}h
    </small>
  </div>;
  if (compact) return <div className="staff-travel-summary staff-travel-summary--compact">
    <small title={`Horas de deslocação: ${number.format(travel.payableHours)}h`}>Desloc. {number.format(travel.payableHours)}h</small>
    {showAmount ? <small title={`Valor da deslocação: ${money.format(travel.amount)}`}>{money.format(travel.amount)}</small> : null}
  </div>;
  return <div className="staff-travel-summary">
    <small>Deslocação: {number.format(travel.payableHours)}h{showAmount ? ` · ${money.format(travel.amount)}` : ''}</small>
    {total && showAmount ? <small>Total staff: {money.format(staffAssignmentPaymentTotal(assignment, event))}</small> : null}
  </div>;
}
