export function computeShortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return [parts[0], parts[1], parts[parts.length - 1]].join(' ');
}

