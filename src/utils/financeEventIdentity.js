import {
  clientChargeHours,
  roundedClockTime,
} from './serviceFinance.js';
import { clientRateForAssignment } from './eventFinancialRules.js';

const INACTIVE_ASSIGNMENT_STATUSES = new Set(['cancelled', 'canceled', 'removed']);
const NON_BILLABLE_ASSIGNMENT_STATUSES = new Set([
  ...INACTIVE_ASSIGNMENT_STATUSES,
  'missed_justified',
  'missed_unjustified',
]);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizedText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-PT');
}

function dateKey(value) {
  if (!value) return '';
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeKey(value) {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function assignmentShiftKey(assignment, event) {
  const start = timeKey(assignment?.plannedCheckIn || event?.startTime);
  const end = timeKey(assignment?.plannedCheckOut || event?.endTime);
  if (!start && !end) return '';
  const workDate = dateKey(assignment?.assignmentDate || event?.date);
  return `${workDate}|${start}|${end}`;
}

function isBillableAssignment(assignment) {
  return !NON_BILLABLE_ASSIGNMENT_STATUSES.has(normalizedText(assignment?.status));
}

function billingSchedule(assignment, event) {
  const candidates = [
    [assignment?.validatedCheckIn, assignment?.validatedCheckOut],
    [assignment?.clientCheckIn, assignment?.clientCheckOut],
    [assignment?.checkIn, assignment?.checkOut],
    [assignment?.plannedCheckIn, assignment?.plannedCheckOut],
    [event?.startTime, event?.endTime],
  ];

  for (const [rawStart, rawEnd] of candidates) {
    const start = roundedClockTime(rawStart);
    const end = roundedClockTime(rawEnd);
    if (start && end) {
      return {
        start,
        end,
        key: `${start}|${end}`,
        label: `${start} - ${end}`,
      };
    }
  }

  return {
    start: '',
    end: '',
    key: 'unscheduled',
    label: 'Horário não registado',
  };
}

function collaboratorKey(assignment, index) {
  const collaborator = assignment?.collaborator || {};
  return cleanText(
    assignment?.collaboratorId
    || collaborator?.id
    || collaborator?.taxId
    || collaborator?.nif
    || collaborator?.name
    || assignment?.collaboratorName
    || assignment?.id
    || `assignment-${index}`,
  );
}

export function financeEventOperationalSummary(event = {}) {
  const assignments = (event.assignments || []).filter(isBillableAssignment);
  const collaborators = new Set();
  const scheduleGroups = new Map();
  let billableHours = 0;

  assignments.forEach((assignment, index) => {
    const personKey = collaboratorKey(assignment, index);
    collaborators.add(personKey);
    const schedule = billingSchedule(assignment, event);
    const assignmentBillableHours = clientChargeHours(
      assignment,
      event.startTime,
      event.endTime,
      event.minimumHoursSnapshot,
    );
    const clientRate = clientRateForAssignment(assignment, event);
    const assignmentBillableValue = assignmentBillableHours * clientRate;
    billableHours += assignmentBillableHours;

    const group = scheduleGroups.get(schedule.key) || {
      ...schedule,
      collaboratorKeys: new Set(),
      entries: [],
      assignmentCount: 0,
      billableHours: 0,
      billableValue: 0,
    };
    group.collaboratorKeys.add(personKey);
    group.assignmentCount += 1;
    group.billableHours += assignmentBillableHours;
    group.billableValue += assignmentBillableValue;
    group.entries.push({
      key: `${String(assignment?.id ?? personKey)}|${index}`,
      collaboratorKey: personKey,
      workDate: dateKey(assignment?.assignmentDate || event?.date),
      collaboratorName: cleanText(
        assignment?.collaborator?.name
        || assignment?.collaborator?.shortName
        || assignment?.collaboratorName,
      ) || '-',
      role: cleanText(assignment?.role) || '-',
      start: schedule.start,
      end: schedule.end,
      label: schedule.label,
      billableHours: assignmentBillableHours,
      billableValue: assignmentBillableValue,
      hasBillableRate: assignmentBillableHours <= 0 || clientRate > 0,
    });
    scheduleGroups.set(schedule.key, group);
  });

  const groups = [...scheduleGroups.values()]
    .map((group) => {
      const entries = group.entries.sort((left, right) => (
        (left.workDate || '9999-99-99').localeCompare(right.workDate || '9999-99-99')
        || left.collaboratorName.localeCompare(right.collaboratorName, 'pt-PT')
        || left.role.localeCompare(right.role, 'pt-PT')
      ));
      const dayGroups = new Map();
      entries.forEach((entry) => {
        const day = dayGroups.get(entry.workDate) || [];
        day.push(entry);
        dayGroups.set(entry.workDate, day);
      });

      return {
        key: group.key,
        start: group.start,
        end: group.end,
        label: group.label,
        collaboratorCount: group.collaboratorKeys.size,
        assignmentCount: group.assignmentCount,
        billableHours: Number(group.billableHours.toFixed(2)),
        billableValue: Number(group.billableValue.toFixed(2)),
        dayGroups: [...dayGroups].map(([workDate, dayEntries]) => ({ workDate, entries: dayEntries })),
      };
    })
    .sort((left, right) => (
      left.key === 'unscheduled'
        ? 1
        : right.key === 'unscheduled'
          ? -1
          : (left.dayGroups.find((day) => day.workDate)?.workDate || '9999-99-99')
            .localeCompare(right.dayGroups.find((day) => day.workDate)?.workDate || '9999-99-99')
            || left.start.localeCompare(right.start, 'pt-PT')
            || left.end.localeCompare(right.end, 'pt-PT')
            || left.key.localeCompare(right.key, 'pt-PT')
    ));

  const daySummaries = new Map();
  groups.forEach((group) => {
    group.dayGroups.forEach((groupDay) => {
      const day = daySummaries.get(groupDay.workDate) || {
        workDate: groupDay.workDate,
        collaboratorKeys: new Set(),
        assignmentCount: 0,
        billableHours: 0,
        billableValue: 0,
        pricingComplete: true,
        entries: [],
      };
      groupDay.entries.forEach((entry) => {
        day.collaboratorKeys.add(entry.collaboratorKey);
        day.assignmentCount += 1;
        day.billableHours += entry.billableHours;
        day.billableValue += entry.billableValue;
        day.pricingComplete = day.pricingComplete && entry.hasBillableRate;
        day.entries.push(entry);
      });
      daySummaries.set(groupDay.workDate, day);
    });
  });

  const days = [...daySummaries.values()]
    .map((day) => ({
      workDate: day.workDate,
      collaboratorCount: day.collaboratorKeys.size,
      assignmentCount: day.assignmentCount,
      billableHours: Number(day.billableHours.toFixed(2)),
      billableValue: Number(day.billableValue.toFixed(2)),
      pricingComplete: day.pricingComplete,
      entries: day.entries.sort((left, right) => (
        left.start.localeCompare(right.start, 'pt-PT')
        || left.collaboratorName.localeCompare(right.collaboratorName, 'pt-PT')
        || left.role.localeCompare(right.role, 'pt-PT')
      )),
    }))
    .sort((left, right) => (
      (left.workDate || '9999-99-99').localeCompare(right.workDate || '9999-99-99')
    ));

  return {
    scheduleCount: groups.filter((group) => group.key !== 'unscheduled').length,
    collaboratorCount: collaborators.size,
    assignmentCount: assignments.length,
    billableHours: Number(billableHours.toFixed(2)),
    scheduleGroups: groups,
    days,
  };
}

export function eventTurnCount(event = {}) {
  const shifts = new Set();
  for (const assignment of event.assignments || []) {
    const status = normalizedText(assignment?.status);
    if (INACTIVE_ASSIGNMENT_STATUSES.has(status)) continue;
    const shift = assignmentShiftKey(assignment, event);
    if (shift) shifts.add(shift);
  }

  if (!shifts.size) {
    const fallback = assignmentShiftKey({}, event);
    if (fallback) shifts.add(fallback);
  }

  return shifts.size;
}

function eventIdentityKey(event) {
  return [
    normalizedText(event?.name),
    dateKey(event?.date),
    dateKey(event?.endDate),
    normalizedText(event?.location),
  ].join('|');
}

function eventFirstShift(event) {
  const keys = (event?.assignments || [])
    .map((assignment) => assignmentShiftKey(assignment, event))
    .filter(Boolean)
    .sort();
  return keys[0] || assignmentShiftKey({}, event);
}

export function buildFinanceEventDescriptors(events = []) {
  const groups = new Map();
  for (const event of events || []) {
    const key = eventIdentityKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  const descriptors = new Map();
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => (
      eventFirstShift(left).localeCompare(eventFirstShift(right), 'pt-PT')
      || Number(left?.id || 0) - Number(right?.id || 0)
    ));

    ordered.forEach((event, index) => {
      descriptors.set(String(event?.id), {
        location: cleanText(event?.location),
        turnCount: eventTurnCount(event),
        sequenceLabel: ordered.length > 1 ? `Serviço ${index + 1}` : '',
        operationalSummary: financeEventOperationalSummary(event),
      });
    });
  }

  return descriptors;
}
