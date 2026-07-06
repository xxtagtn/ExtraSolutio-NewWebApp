const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map();

export function readApiCache(path) {
  const entry = responseCache.get(path);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    responseCache.delete(path);
    return undefined;
  }
  return entry.data;
}

export function writeApiCache(path, data) {
  responseCache.set(path, { data, at: Date.now() });
}

export function invalidateApiCache(prefix = '') {
  if (!prefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}
