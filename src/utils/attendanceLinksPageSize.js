const PAGE_SIZES = [10, 25, 50, 100];

function storageKey(userId) {
  const id = Number(userId);
  return Number.isSafeInteger(id) && id > 0 ? `extrasolutio.communication.attendanceLinks.pageSize:${id}` : null;
}

export function normalizeAttendanceLinksPageSize(value) {
  return PAGE_SIZES.includes(Number(value)) ? Number(value) : 25;
}

export function readAttendanceLinksPageSize(userId, storage) {
  const key = storageKey(userId);
  if (!key) return 25;
  try {
    return normalizeAttendanceLinksPageSize((storage || globalThis.localStorage).getItem(key));
  } catch {
    return 25;
  }
}

export function saveAttendanceLinksPageSize(userId, value, storage) {
  const size = normalizeAttendanceLinksPageSize(value);
  const key = storageKey(userId);
  if (key) {
    try {
      (storage || globalThis.localStorage).setItem(key, String(size));
    } catch {
      // An unavailable browser preference must not block the current selection.
    }
  }
  return size;
}
