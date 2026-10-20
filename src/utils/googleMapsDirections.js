export function googleMapsDirectionsUrl(location) {
  const destination = typeof location === 'string' ? location.trim() : '';
  if (!destination) return null;
  const url = new globalThis.URL('https://www.google.com/maps/dir/');
  url.search = new globalThis.URLSearchParams({ api: '1', destination }).toString();
  return url.href.length <= 2048 ? url.href : null;
}
