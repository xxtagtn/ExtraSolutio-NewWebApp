export function mergeCollaboratorDetail(row, detail) {
  if (!detail) return row || {};
  return {
    ...(row || {}),
    ...detail,
    roles: detail.roles || row?.roles || [],
  };
}

export function collaboratorPhotoSource(row, detail) {
  return String(detail?.photo || row?.photo || '');
}

export function shouldFetchCollaboratorDetail(row, detail, loading = false) {
  if (!row?.id || loading) return false;
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'photo')) return false;
  return row.photo === undefined;
}
