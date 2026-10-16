export function privatePhotoPath(source, apiUrl, origin = globalThis.location?.origin || 'http://localhost') {
  const raw = String(source || '');
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const base = new globalThis.URL(apiUrl, origin);
      const url = new globalThis.URL(raw);
      if (url.origin !== base.origin) return null;
      path = url.pathname;
    } catch { return null; }
  }
  return path.startsWith('/uploads/collaborators/') && !path.includes('?') && !path.includes('#') ? path : null;
}
