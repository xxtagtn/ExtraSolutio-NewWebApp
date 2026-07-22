import * as XLSX from 'xlsx';
import { clientChargeHours, clientRealHours, decimalValue } from '../../src/utils/serviceFinance.js';
import { collaboratorRoleOptions } from '../../src/utils/collaboratorRoles.js';

const FIELD_ALIASES = {
  sessionName: ['nome da sessao', 'sessao', 'evento', 'servico'],
  collaboratorName: ['nome do colaborador', 'colaborador', 'nome'],
  documentNumber: ['numero de identificacao', 'n de identificacao', 'documento'],
  nif: ['nif'],
  entity: ['entidade'],
  department: ['departamento'],
  category: ['categoria', 'funcao', 'cargo'],
  eventDate: ['data do evento', 'data'],
  plannedCheckIn: ['entrada prevista', 'hora prevista', 'horario previsto'],
  plannedHours: ['horas de trabalho planeadas', 'horas planeadas'],
  plannedValue: ['valor planeado'],
  clientCheckIn: ['hora de entrada', 'entrada real', 'entrada cliente'],
  clientCheckOut: ['hora de saida', 'saida real', 'saida cliente'],
  clientHours: ['horas cumpridas', 'horas cliente'],
};

const ROLE_ALIASES = new Map([
  ['empregado de mesa', 'Emp.Mesa'],
  ['emp mesa', 'Emp.Mesa'],
  ['emp.mesa', 'Emp.Mesa'],
  ['copa fina', 'Copa Fina'],
  ['barman', 'Barman'],
  ['chefe de sala', 'Chefe de Sala'],
  ['cozinheiro', 'Cozinheiro'],
  ['ajd cozinha', 'Ajd.Cozinha'],
  ['ajd.cozinha', 'Ajd.Cozinha'],
  ['logista', 'Logista'],
  ['corte de presunto', 'Corte de Presunto'],
  ['trinchar', 'Trinchar'],
]);

export const EVENT_NAME_MAPPING_PREFIX = 'event-name:';

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function normalizeKey(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[ºª°]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeNif(value) {
  return normalizeText(value).replace(/\D/g, '');
}

function localDateKey(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function excelSerialToDate(value) {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
}

function parseDateKey(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date) return localDateKey(value);
  if (typeof value === 'number') {
    const date = excelSerialToDate(value);
    return date ? localDateKey(date) : '';
  }
  const text = normalizeText(value);
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const ptMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (ptMatch) {
    const year = ptMatch[3].length === 2 ? `20${ptMatch[3]}` : ptMatch[3];
    return `${year}-${ptMatch[2].padStart(2, '0')}-${ptMatch[1].padStart(2, '0')}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : localDateKey(date);
}

function storedDateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = normalizeText(value);
  const isoMatch = text.match(/^(\d{4}-\d{1,2}-\d{1,2})/);
  return isoMatch ? parseDateKey(isoMatch[1]) : parseDateKey(value);
}

function sameStoredDate(a, b) {
  const left = storedDateKey(a);
  const right = storedDateKey(b);
  return Boolean(left && right && left === right);
}

function minutesToTime(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseTime(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date) return minutesToTime((value.getHours() * 60) + value.getMinutes());
  if (typeof value === 'number') {
    if (value >= 0 && value < 1) return minutesToTime(value * 24 * 60);
    const date = excelSerialToDate(value);
    return date ? minutesToTime((date.getHours() * 60) + date.getMinutes()) : '';
  }
  const text = normalizeText(value);
  if (!text) return '';
  const dateTimeMatch = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (dateTimeMatch) return `${dateTimeMatch[1].padStart(2, '0')}:${dateTimeMatch[2]}`;
  const compactMatch = text.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (compactMatch) return `${compactMatch[1].padStart(2, '0')}:${compactMatch[2] || '00'}`;
  return '';
}

function parseDurationHours(value) {
  if (!value && value !== 0) return 0;
  if (value instanceof Date) return Number((((value.getHours() * 60) + value.getMinutes()) / 60).toFixed(2));
  if (typeof value === 'number') {
    const hours = value > 1 ? value : value * 24;
    return Number(hours.toFixed(2));
  }
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,3}):(\d{2})(?::\d{2})?$/);
  if (match) return Number((Number(match[1]) + (Number(match[2]) / 60)).toFixed(2));
  const numeric = Number(text.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number(value.toFixed(2));
  const numeric = Number(String(value).replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}

function headerFieldFor(value) {
  const normalized = normalizeKey(value);
  return Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

function detectHeaderRow(rows) {
  let best = { index: -1, fields: {}, score: 0 };
  rows.forEach((row, index) => {
    const fields = {};
    row.forEach((cell, columnIndex) => {
      const field = headerFieldFor(cell);
      if (field && fields[field] === undefined) fields[field] = columnIndex;
    });
    const score = Object.keys(fields).length;
    if (score > best.score) best = { index, fields, score };
  });
  if (best.score < 5) {
    const error = new Error('Não foi possível identificar os cabeçalhos do Excel.');
    error.statusCode = 422;
    throw error;
  }
  return best;
}

function valueAt(row, fields, field) {
  const index = fields[field];
  return index === undefined ? undefined : row[index];
}

function parsedRowFrom(values, fields, rowNumber) {
  return {
    rowNumber,
    sessionName: normalizeText(valueAt(values, fields, 'sessionName')),
    collaboratorName: normalizeText(valueAt(values, fields, 'collaboratorName')),
    documentNumber: normalizeText(valueAt(values, fields, 'documentNumber')),
    nif: normalizeNif(valueAt(values, fields, 'nif')),
    entity: normalizeText(valueAt(values, fields, 'entity')),
    department: normalizeText(valueAt(values, fields, 'department')),
    category: normalizeText(valueAt(values, fields, 'category')),
    eventDate: parseDateKey(valueAt(values, fields, 'eventDate')),
    plannedCheckIn: parseTime(valueAt(values, fields, 'plannedCheckIn')),
    plannedHours: parseDurationHours(valueAt(values, fields, 'plannedHours')),
    plannedValue: parseMoney(valueAt(values, fields, 'plannedValue')),
    clientCheckIn: parseTime(valueAt(values, fields, 'clientCheckIn')),
    clientCheckOut: parseTime(valueAt(values, fields, 'clientCheckOut')),
    clientHours: parseDurationHours(valueAt(values, fields, 'clientHours')),
  };
}

export function parseTimeValidationWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const error = new Error('O Excel não contém folhas para importar.');
    error.statusCode = 422;
    throw error;
  }
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const firstSheetRowNumber = range.s.r + 1;
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: '',
  });
  const header = detectHeaderRow(rows);
  const parsedRows = rows
    .slice(header.index + 1)
    .map((row, offset) => parsedRowFrom(row, header.fields, firstSheetRowNumber + header.index + offset + 1))
    .filter((row) => row.sessionName || row.collaboratorName || row.nif || row.clientCheckIn || row.clientCheckOut);

  return {
    sheetName,
    headerRowNumber: firstSheetRowNumber + header.index,
    columns: Object.fromEntries(Object.entries(header.fields).map(([field, index]) => [field, String(rows[header.index][index] || '')])),
    rows: parsedRows,
  };
}

function mappingKey(field, externalValue) {
  return `${field}:${normalizeKey(externalValue)}`;
}

function mappingsByField(mappings = []) {
  const map = new Map();
  for (const mapping of mappings) {
    if (!mapping?.field || !mapping?.externalValue) continue;
    map.set(mappingKey(mapping.field, mapping.externalValue), String(mapping.internalValue ?? ''));
  }
  return map;
}

function mappingValue(map, field, externalValue) {
  return map.get(mappingKey(field, externalValue)) || '';
}

function autoRole(value) {
  const normalized = normalizeKey(value);
  if (ROLE_ALIASES.has(normalized)) return ROLE_ALIASES.get(normalized);
  const exact = collaboratorRoleOptions.find((role) => normalizeKey(role) === normalized);
  return exact || '';
}

function eventDateMatches(event, eventDate) {
  if (!eventDate) return false;
  const start = storedDateKey(event.date);
  const end = storedDateKey(event.endDate || event.date);
  return start && end && eventDate >= start && eventDate <= end;
}

function normalizedTokens(value) {
  return new Set(normalizeKey(value).split(' ').filter((token) => token.length >= 3));
}

function eventTextForMatching(event) {
  return [
    event?.name,
    event?.eventType,
    event?.clientName,
    event?.client?.name,
    event?.location,
  ].filter(Boolean).join(' ');
}

function eventMatchesDepartment(event, department) {
  const departmentKey = normalizeKey(department);
  if (!departmentKey) return false;
  return [event?.eventType, event?.department, event?.category, event?.name]
    .filter(Boolean)
    .some((value) => normalizeKey(value) === departmentKey || normalizeKey(value).includes(departmentKey));
}

function eventNameMatchScore(event, sessionName) {
  const sourceTokens = normalizedTokens(sessionName);
  const targetTokens = normalizedTokens(eventTextForMatching(event));
  if (!sourceTokens.size || !targetTokens.size) return 0;
  return [...sourceTokens].reduce((score, token) => score + (targetTokens.has(token) ? 1 : 0), 0);
}

function selectBestEvent(candidates, row) {
  if (!candidates.length) return { event: null, method: '' };
  const exactName = candidates.filter((event) => normalizeKey(event.name) === normalizeKey(row.sessionName));
  if (exactName.length === 1) return { event: exactName[0], method: 'name' };

  const hasDepartment = Boolean(normalizeKey(row.department));
  const departmentCandidates = hasDepartment
    ? candidates.filter((event) => eventMatchesDepartment(event, row.department))
    : candidates;
  if (hasDepartment && !departmentCandidates.length) {
    const rankedByName = candidates
      .map((event) => ({ event, score: eventNameMatchScore(event, row.sessionName) }))
      .sort((a, b) => b.score - a.score);
    if (rankedByName[0]?.score >= 2 && rankedByName[0].score > (rankedByName[1]?.score || 0)) {
      return { event: rankedByName[0].event, method: 'date_name' };
    }
    return { event: null, method: '' };
  }

  const pool = departmentCandidates;
  if (pool.length === 1) {
    return {
      event: pool[0],
      method: departmentCandidates.length ? 'date_department' : 'date',
    };
  }

  const ranked = pool
    .map((event) => ({ event, score: eventNameMatchScore(event, row.sessionName) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score || 0)) {
    return { event: ranked[0].event, method: 'date_name' };
  }
  return { event: null, method: '' };
}

function findEvent(row, services, mappings, collaborator, role) {
  const mappedEventId = mappingValue(mappings, 'session', row.sessionName);
  if (mappedEventId) {
    const mappedEventName = mappedEventId.startsWith(EVENT_NAME_MAPPING_PREFIX)
      ? mappedEventId.slice(EVENT_NAME_MAPPING_PREFIX.length)
      : '';
    const mappedCandidates = mappedEventName
      ? services.filter((item) => (
        eventDateMatches(item, row.eventDate)
        && normalizeKey(item.name) === normalizeKey(mappedEventName)
      ))
      : [];
    const mappedEvent = mappedEventName
      ? selectBestEvent(mappedCandidates, { ...row, sessionName: mappedEventName }).event
      : services.find((item) => String(item.id) === mappedEventId) || null;
    // Uma etiqueta externa mensal pode abranger varios eventos semanais internos.
    // Nunca reutilizar um mapeamento guardado fora do intervalo real do evento.
    if (mappedEvent && eventDateMatches(mappedEvent, row.eventDate)) {
      return {
        event: mappedEvent,
        method: 'mapping',
      };
    }
  }
  const candidates = services.filter((item) => eventDateMatches(item, row.eventDate));

  if (collaborator) {
    const assignmentMatches = candidates
      .map((event) => {
        const result = findAssignment(row, event, collaborator, role);
        return result.assignment ? { event, assignment: result.assignment } : null;
      })
      .filter(Boolean);
    if (assignmentMatches.length === 1) {
      return { event: assignmentMatches[0].event, method: 'assignment' };
    }
    if (assignmentMatches.length > 1) {
      const ranked = assignmentMatches
        .map((match) => ({
          ...match,
          score: timeDistanceMinutes(
            row.plannedCheckIn,
            match.assignment.plannedCheckIn || match.event.startTime,
          ),
        }))
        .sort((a, b) => a.score - b.score);
      if (ranked[0].score < (ranked[1]?.score ?? 9999)) {
        return { event: ranked[0].event, method: 'assignment' };
      }
    }
  }

  return selectBestEvent(candidates, row);
}

function findCollaborator(row, collaborators = [], mappings = new Map()) {
  const mappedCollaboratorId = mappingValue(mappings, 'collaborator', row.nif || row.collaboratorName);
  if (mappedCollaboratorId) {
    const match = collaborators.find((collaborator) => String(collaborator.id) === String(mappedCollaboratorId));
    if (match) return match;
  }
  const nif = normalizeNif(row.nif);
  if (nif) {
    const match = collaborators.find((collaborator) => normalizeNif(collaborator.nif) === nif);
    if (match) return match;
  }
  const name = normalizeKey(row.collaboratorName);
  if (!name) return null;
  const matches = collaborators.filter((collaborator) => normalizeKey(collaborator.name || collaborator.shortName) === name);
  return matches.length === 1 ? matches[0] : null;
}

function timeDistanceMinutes(a, b) {
  const normalizedA = parseTime(a);
  const normalizedB = parseTime(b);
  if (!normalizedA || !normalizedB) return 9999;
  const [ah, am] = normalizedA.split(':').map(Number);
  const [bh, bm] = normalizedB.split(':').map(Number);
  if (![ah, am, bh, bm].every(Number.isFinite)) return 9999;
  return Math.abs(((ah * 60) + am) - ((bh * 60) + bm));
}

function findAssignment(row, event, collaborator, role) {
  if (!event || !collaborator) return { assignment: null, ambiguous: false };
  const baseCandidates = (event.assignments || []).filter((assignment) => (
    String(assignment.collaboratorId) === String(collaborator.id)
    && (!row.eventDate || sameStoredDate(assignment.assignmentDate || event.date, row.eventDate))
  ));
  const exactRoleCandidates = role
    ? baseCandidates.filter((assignment) => normalizeKey(assignment.role) === normalizeKey(role))
    : baseCandidates;
  const rolelessCandidates = role
    ? baseCandidates.filter((assignment) => !assignment.role || normalizeKey(assignment.role) === 'sem funcao')
    : baseCandidates;
  const candidates = exactRoleCandidates.length ? exactRoleCandidates : rolelessCandidates;
  if (candidates.length === 1) return { assignment: candidates[0], ambiguous: false };
  if (!candidates.length) return { assignment: null, ambiguous: false };
  const ranked = candidates
    .map((assignment) => ({
      assignment,
      score: timeDistanceMinutes(row.plannedCheckIn, assignment.plannedCheckIn || event.startTime),
    }))
    .sort((a, b) => a.score - b.score);
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return { assignment: null, ambiguous: true };
  }
  return { assignment: ranked[0].assignment, ambiguous: false };
}

function unresolvedBucket() {
  return {
    session: [],
    category: [],
    department: [],
    collaborator: [],
    assignment: [],
  };
}

function addUnresolved(bucket, field, externalValue, label) {
  if (!externalValue) return;
  if (bucket[field].some((item) => item.externalValue === externalValue)) return;
  bucket[field].push({ field, externalValue, label: label || externalValue });
}

function calculatedPayload(row, assignment, event) {
  const merged = {
    ...assignment,
    clientCheckIn: row.clientCheckIn,
    clientCheckOut: row.clientCheckOut,
  };
  const clientReal = clientRealHours(merged);
  const clientBillable = clientChargeHours(
    merged,
    event?.startTime,
    event?.endTime,
    event?.minimumHoursSnapshot,
  );
  const hasClientTimes = Boolean(row.clientCheckIn && row.clientCheckOut);
  return {
    clientRealHours: Number((hasClientTimes ? clientReal : (row.clientHours || clientReal)).toFixed(2)),
    clientBillableHours: Number(clientBillable.toFixed(2)),
  };
}

export function buildImportPreview(rows = [], context = {}) {
  const mappings = mappingsByField(context.mappings || []);
  const services = context.services || [];
  const collaborators = context.collaborators || [];
  const unresolvedMappings = unresolvedBucket();
  const previewRows = rows.map((row) => {
    const errors = [];
    const warnings = [];
    const mappingFields = [];
    const mappedRole = mappingValue(mappings, 'category', row.category) || autoRole(row.category);
    if (!mappedRole) {
      errors.push('Função não reconhecida.');
      mappingFields.push('category');
      addUnresolved(unresolvedMappings, 'category', row.category);
    }

    const collaborator = findCollaborator(row, collaborators, mappings);
    if (!collaborator) {
      errors.push('Colaborador não reconhecido.');
      mappingFields.push('collaborator');
      addUnresolved(unresolvedMappings, 'collaborator', row.nif || row.collaboratorName, row.collaboratorName);
    }

    const mappedDepartment = mappingValue(mappings, 'department', row.department) || row.department;
    const mappedRow = mappedDepartment === row.department ? row : { ...row, department: mappedDepartment };

    // O nome da sessão do cliente pode ser diferente do nome interno do evento.
    // Um turno já planeado é a evidência mais segura para associar os dois registos.
    const eventMatch = findEvent(mappedRow, services, mappings, collaborator, mappedRole);
    const event = eventMatch.event;
    if (event && eventMatch.method === 'assignment') {
      warnings.push('Evento associado automaticamente pelo colaborador, data e turno.');
    } else if (event && eventMatch.method !== 'name' && eventMatch.method !== 'mapping') {
      warnings.push('Evento associado automaticamente pela data e pelo departamento.');
    }
    if (!event) {
      errors.push('Evento/Serviço não reconhecido.');
      mappingFields.push('session');
      addUnresolved(unresolvedMappings, 'session', row.sessionName);
      if (row.department) addUnresolved(unresolvedMappings, 'department', row.department);
    }

    const { assignment, ambiguous } = findAssignment(mappedRow, event, collaborator, mappedRole);
    let hasOperationalBlocker = false;
    if (ambiguous) {
      errors.push('Turno ambíguo para este colaborador.');
      hasOperationalBlocker = true;
    } else if (!assignment && event && collaborator) {
      errors.push('Turno não encontrado no evento.');
      hasOperationalBlocker = true;
    }

    if (!row.clientCheckIn || !row.clientCheckOut) {
      errors.push('Horário Cliente incompleto.');
      hasOperationalBlocker = true;
    }

    const payload = assignment && event ? calculatedPayload(row, assignment, event) : {};
    const status = errors.length ? 'invalid' : warnings.length ? 'warning' : 'valid';
    const resolutionType = !errors.length
      ? 'recognized'
      : mappingFields.length && !hasOperationalBlocker
        ? 'needs_mapping'
        : 'invalid';

    return {
      ...row,
      status,
      resolutionType,
      mappingFields,
      errors,
      warnings,
      eventId: event?.id || null,
      eventName: event?.name || '',
      collaboratorId: collaborator?.id || null,
      collaboratorName: collaborator?.name || row.collaboratorName,
      role: mappedRole || row.category,
      assignmentId: assignment?.id || null,
      clientCheckIn: row.clientCheckIn,
      clientCheckOut: row.clientCheckOut,
      clientRealHours: payload.clientRealHours ?? 0,
      clientBillableHours: payload.clientBillableHours ?? 0,
    };
  });

  return {
    summary: {
      totalRows: previewRows.length,
      validRows: previewRows.filter((row) => row.status === 'valid' || row.status === 'warning').length,
      invalidRows: previewRows.filter((row) => row.status === 'invalid').length,
      warningRows: previewRows.filter((row) => row.status === 'warning').length,
      recognizedRows: previewRows.filter((row) => row.resolutionType === 'recognized').length,
      mappingRows: previewRows.filter((row) => row.resolutionType === 'needs_mapping').length,
      blockedRows: previewRows.filter((row) => row.resolutionType === 'invalid').length,
    },
    unresolvedMappings,
    rows: previewRows,
  };
}

export function normalizeImportMappings(mappings = [], source = 'time_validation_excel', defaultScopeKey = 'global') {
  return mappings
    .filter((mapping) => mapping?.field && mapping?.externalValue && mapping?.internalValue !== undefined)
    .map((mapping) => ({
      source,
      scopeKey: mapping.scopeKey || defaultScopeKey,
      field: String(mapping.field),
      externalValue: normalizeText(mapping.externalValue),
      internalValue: String(mapping.internalValue),
    }));
}

export function assignmentUpdateFromPreviewRow(row = {}) {
  return {
    assignmentId: Number(row.assignmentId),
    data: {
      clientCheckIn: row.clientCheckIn || null,
      clientCheckOut: row.clientCheckOut || null,
      clientRealHours: decimalValue(row.clientRealHours),
      clientBillableHours: decimalValue(row.clientBillableHours),
      validationStatus: row.validationStatus || 'pending',
    },
  };
}
