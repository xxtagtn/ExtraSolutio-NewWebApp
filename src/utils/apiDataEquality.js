export function isSameApiData(previous, next) {
  if (Object.is(previous, next)) return true;
  try {
    return JSON.stringify(previous) === JSON.stringify(next);
  } catch {
    return false;
  }
}
