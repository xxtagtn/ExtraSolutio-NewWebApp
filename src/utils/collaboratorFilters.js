import { collaboratorRoleOptions } from './collaboratorRoles.js';

const ROLE_SEARCH_NAMES = {
  'emp mesa': ['empregado de mesa', 'empregados de mesa'],
  'ajd cozinha': ['ajudante de cozinha', 'ajudantes de cozinha'],
};
const STATUS_SEARCH_NAMES = {
  active: ['active', 'ativo', 'ativa', 'ativos', 'ativas'],
  inactive: ['inactive', 'inativo', 'inativa', 'inativos', 'inativas'],
  paused: ['paused', 'pausado', 'pausada', 'pausados', 'pausadas', 'pausa'],
};

export function normalizeCollaboratorSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[._/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function roleValues(row) {
  const roles = Array.isArray(row.roles) ? row.roles.map(role => typeof role === 'string' ? role : role?.role).filter(Boolean) : [];
  return roles.length ? roles : (row.category ? [row.category] : []);
}

function roleSearchNames(role) {
  const normalized = normalizeCollaboratorSearch(role);
  return [normalized, ...(ROLE_SEARCH_NAMES[normalized] || [])];
}

function searchCriteria(terms, rows) {
  const knownRoles = [...new Set([...collaboratorRoleOptions, ...rows.flatMap(row => row ? roleValues(row) : [])])];
  const phrases = knownRoles.flatMap(role => roleSearchNames(role).map(text => ({ role, text, words: text.split(' ') })))
    .sort((a, b) => b.words.length - a.words.length);
  const criteria = [];
  for (let index = 0; index < terms.length;) {
    const phrase = phrases.find(item => item.words.length > 1 && terms.slice(index, index + item.words.length).join(' ') === item.text);
    if (phrase) {
      criteria.push({ roles: new Set(phrases.filter(item => item.text === phrase.text).map(item => item.role)) });
      index += phrase.words.length;
      continue;
    }
    const term = terms[index++];
    const roleWord = term.length >= 3 && (['mesa', 'cozinha'].includes(term)
      || phrases.some(item => item.words[0].startsWith(term)));
    criteria.push(roleWord
      ? { roles: new Set(phrases.filter(item => item.text.includes(term)).map(item => item.role)) }
      : { term });
  }
  return criteria;
}

export function filterCollaborators(rows, filters = {}, { includeSensitive = false } = {}) {
  const {
    nameFilter = '',
    roleFilter = '',
    statusFilter = '',
    ownCarOnly = false,
    ownCarFilter = '',
    zoneFilter = '',
  } = filters;
  const searchText = normalizeCollaboratorSearch(filters.search ?? nameFilter);
  const terms = searchText.split(' ').filter(Boolean);
  const criteria = searchCriteria(terms, rows || []);
  const zone = normalizeCollaboratorSearch(zoneFilter);
  const requestedCar = ownCarFilter === 'true' ? true : ownCarFilter === 'false' ? false : ownCarOnly ? true : null;

  return (rows || []).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const roles = roleValues(row);
    const byRole = roleFilter ? roles.includes(roleFilter) : true;
    const byStatus = statusFilter ? row.status === statusFilter : true;
    const byOwnCar = requestedCar === null || Boolean(row.hasOwnCar) === requestedCar;
    const byZone = !zone || (includeSensitive && normalizeCollaboratorSearch(row.residenceArea).includes(zone));
    if (!byRole || !byStatus || !byOwnCar || !byZone) return false;
    if (!terms.length) return true;
    if ([row.name, row.shortName].some(name => name && normalizeCollaboratorSearch(name) === searchText)) return true;

    const fields = [row.name, row.shortName, row.email, row.phone, row.availability,
      String(row.phone || '').replace(/\D/g, ''),
      ...roles.flatMap(roleSearchNames),
      row.hasOwnCar ? 'com carro tem carro carro proprio viatura propria' : '',
      ...(includeSensitive ? [row.notes, row.residenceArea, row.nif] : []),
    ].filter(value => value !== undefined && value !== null && value !== '').map(normalizeCollaboratorSearch);
    const statuses = STATUS_SEARCH_NAMES[row.status] || [];
    // Each term must match this person; never concatenate fields or merge people.
    return criteria.every(criterion => criterion.roles
      ? roles.some(role => criterion.roles.has(role))
      : String(row.id ?? '') === criterion.term || statuses.includes(criterion.term)
        || fields.some(field => field.includes(criterion.term)));
  });
}
