import { eventDayKey } from './eventCancelledDays.js';

export function groupQrRowsByCollaboratorDay(rows, fallbackDate) {
  const groups = new Map();
  for (const row of rows) {
    const day = eventDayKey(row.assignmentDate || fallbackDate);
    const key = row.collaboratorId && day
      ? `${row.collaboratorId}:${day}`
      : `assignment:${row.assignmentId ?? row.id}`;
    if (!groups.has(key)) groups.set(key, { key, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}
