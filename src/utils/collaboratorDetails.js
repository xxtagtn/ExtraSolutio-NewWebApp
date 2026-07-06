export function mergeCollaboratorDetail(row, detail) {
  if (!detail) return row || {};
  return {
    ...(row || {}),
    ...detail,
    roles: detail.roles || row?.roles || [],
  };
}

function apiOrigin() {
  try {
    const base = import.meta.env?.VITE_API_URL || '';
    return base ? new globalThis.URL(base).origin : '';
  } catch {
    return '';
  }
}

export function collaboratorPhotoSource(row, detail) {
  const raw = String(detail?.photo || row?.photo || '');
  if (raw.startsWith('/uploads/')) {
    return `${apiOrigin()}${raw}`;
  }
  return raw;
}

export function shouldFetchCollaboratorDetail(row, detail, loading = false) {
  if (!row?.id || loading) return false;
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'photo')) return false;
  return row.photo === undefined;
}
