function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function searchText(collaborator = {}) {
  return [
    collaborator.shortName,
    collaborator.name,
    collaborator.nif,
    collaborator.phone,
    collaborator.email,
  ].map(normalize).join(' ');
}

function startsWithQuery(collaborator = {}, query = '') {
  const normalizedQuery = normalize(query);
  return [collaborator.shortName, collaborator.name]
    .map(normalize)
    .some((value) => value.startsWith(normalizedQuery));
}

export function filterCollaboratorOptions(collaborators = [], query = '') {
  const normalizedQuery = normalize(query);
  const list = Array.isArray(collaborators) ? collaborators : [];
  if (!normalizedQuery) return list;

  return list
    .filter((collaborator) => searchText(collaborator).includes(normalizedQuery))
    .sort((a, b) => {
      const aStarts = startsWithQuery(a, normalizedQuery);
      const bStarts = startsWithQuery(b, normalizedQuery);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return String(a.shortName || a.name || '').localeCompare(String(b.shortName || b.name || ''), 'pt', { sensitivity: 'base' });
    });
}
