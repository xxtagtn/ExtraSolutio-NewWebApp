export const SERVICE_ORDER_LIMIT = 20000;
export const emptyServiceOrder = () => ({ mode: 'date', ids: [], version: 0 });

export function validServiceOrder(value) {
  return value && ['date', 'manual'].includes(value.mode)
    && Number.isSafeInteger(value.version) && value.version >= 0
    && Array.isArray(value.ids) && value.ids.length <= SERVICE_ORDER_LIMIT
    && value.ids.every((id) => Number.isSafeInteger(id) && id > 0)
    && new Set(value.ids).size === value.ids.length;
}

export function sortServiceRows(rows, preference = emptyServiceOrder()) {
  const byDate = [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id);
  if (preference.mode !== 'manual') return byDate;
  const rank = new Map(preference.ids.map((id, index) => [id, index]));
  // New events appear first; the existing personal order is otherwise stable.
  return byDate.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
}

export function moveVisibleService(fullIds, visibleIds, activeId, overId) {
  const from = visibleIds.indexOf(activeId), to = visibleIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const visible = new Set(visibleIds), full = new Set(fullIds);
  if (visibleIds.some((id) => !full.has(id))) return null;
  const moved = [...visibleIds];
  moved.splice(to, 0, moved.splice(from, 1)[0]);
  let index = 0;
  // Only replace visible slots: filters and archive pages never move hidden rows.
  return fullIds.map((id) => visible.has(id) ? moved[index++] : id);
}
