import { isAssignmentOnCancelledDay } from '../../utils/eventCancelledDays.js';
import { isBillableEventAssignment } from '../../utils/eventFinancialRules.js';
import { normalizeTravelCars } from '../../utils/travelCalculator.js';
import { staffTravelCompensation, staffTravelGroupKey } from '../../utils/staffTravel.js';
import './staffTravel.css';

const hoursFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });

export default function StaffTravelAutomaticSummary({ event, assignments, onSplitChange }) {
  const car = normalizeTravelCars(event.travelCars)[0];
  const durationHours = car?.durationHours || 0;
  const confirmed = (assignments || []).filter((assignment) => (
    isBillableEventAssignment(assignment)
    && String(assignment.status || '').toLowerCase() === 'confirmed'
    && assignment.collaboratorId
    && !isAssignmentOnCancelledDay(assignment, event)
  ));
  const groups = new Map();
  for (const assignment of confirmed) {
    const key = staffTravelGroupKey(assignment, event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(assignment);
  }
  const compensated = [...groups.values()].filter((rows) => {
    return rows.some((assignment) => staffTravelCompensation(assignment, event, assignments).payableHours > 0);
  });
  const payableHours = durationHours * (event.split5050 ? 0.5 : 1);

  return <section className="staff-travel-auto-summary span-2">
    <h4>Compensação de deslocação do staff</h4>
    {durationHours > 0 ? <>
      <p><strong>{car.label || 'Primeiro carro'}</strong> · {hoursFormat.format(durationHours)}h de ida e volta</p>
      <p>
        Aplicada automaticamente a {compensated.length} colaborador(es) confirmado(s),
        {' '}{hoursFormat.format(payableHours)}h por colaborador e dia.
      </p>
      {event.travelType !== 'kilometers' ? <label className="check-inline service-check staff-travel-auto-summary__split">
        <input type="checkbox" checked={Boolean(event.split5050)} onChange={(e) => onSplitChange(e.target.checked)} />
        <span>50/50 no tempo de deslocação</span>
      </label> : null}
    </> : <p>Define horas de ida e volta na configuração do carro para calcular automaticamente a compensação.</p>}
  </section>;
}
