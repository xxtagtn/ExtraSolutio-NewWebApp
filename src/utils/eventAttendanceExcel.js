const WORKBOOK_COLUMNS = [
  { key: 'index', label: 'N.º', width: 5 },
  { key: 'collaborator', label: 'Colaborador', width: 26 },
  { key: 'nif', label: 'NIF', width: 13 },
  { key: 'role', label: 'Função', width: 16 },
  { key: 'workLocation', label: 'Local / Área', width: 17 },
  { key: 'plannedSchedule', label: 'Horário previsto', width: 16 },
  { key: 'actualCheckIn', label: 'Entrada real', width: 11 },
  { key: 'actualCheckOut', label: 'Saída real', width: 11 },
  { key: 'signature', label: 'Assinatura', width: 20 },
  { key: 'notes', label: 'Observações', width: 24 },
];

const ATTENDANCE_PRINT = {
  orientation: 'landscape',
  paperSize: 9,
  fitToWidth: 1,
  singlePageRowLimit: 30,
  margins: {
    left: 0.1,
    right: 0.1,
    top: 0.12,
    bottom: 0.12,
    header: 0.05,
    footer: 0.05,
  },
};

const COLORS = {
  accent: '18BFB2',
  accentDark: '0C605C',
  border: '40525A',
  dark: '0B1419',
  darkSoft: '152329',
  light: 'E8F1F2',
  muted: 'A9B8BC',
  white: 'FFFFFF',
};

function normalizeDateKey(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const europeanMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (europeanMatch) return `${europeanMatch[3]}-${europeanMatch[2]}-${europeanMatch[1]}`;
  return '';
}

function formatDate(value) {
  const key = normalizeDateKey(value);
  if (!key) return '-';
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

function formatWeekday(value) {
  const key = normalizeDateKey(value);
  if (!key) return '';
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  const label = new Intl.DateTimeFormat('pt-PT', { weekday: 'long' }).format(parsed);
  return label.charAt(0).toLocaleUpperCase('pt-PT') + label.slice(1);
}

function collaboratorForAssignment(assignment, collaborators) {
  return assignment.collaborator
    || collaborators.find((item) => String(item.id) === String(assignment.collaboratorId))
    || {};
}

function workLocationForAssignment(assignment, workLocations) {
  if (assignment.workLocation?.name) return assignment.workLocation.name;
  return workLocations.find((item) => String(item.id) === String(assignment.workLocationId))?.name || '';
}

function scheduleValue(checkIn, checkOut) {
  const start = String(checkIn || '').slice(0, 5);
  const end = String(checkOut || '').slice(0, 5);
  if (!start && !end) return '';
  return `${start || '--:--'} - ${end || '--:--'}`;
}

function statusAllowsAttendanceSheet(status) {
  return !['cancelled', 'missed_justified', 'missed_unjustified'].includes(
    String(status || '').trim().toLowerCase(),
  );
}

export function buildEventAttendanceRows({
  assignments = [],
  collaborators = [],
  workLocations = [],
  selectedDay = '',
  isContinuous = false,
} = {}) {
  const selectedDate = normalizeDateKey(selectedDay);
  return assignments
    .filter((assignment) => assignment?.collaboratorId)
    .filter((assignment) => statusAllowsAttendanceSheet(assignment.status))
    .filter((assignment) => (
      !isContinuous
      || !selectedDate
      || normalizeDateKey(assignment.assignmentDate) === selectedDate
    ))
    .map((assignment) => {
      const collaborator = collaboratorForAssignment(assignment, collaborators);
      return {
        collaborator: collaborator.name || collaborator.shortName || `Colaborador ${assignment.collaboratorId}`,
        nif: collaborator.nif || '',
        role: assignment.role || collaborator.category || 'Sem função',
        workLocation: workLocationForAssignment(assignment, workLocations),
        plannedSchedule: scheduleValue(assignment.plannedCheckIn, assignment.plannedCheckOut),
        plannedCheckIn: String(assignment.plannedCheckIn || '').slice(0, 5),
        sourceKey: assignment.id || assignment.rowKey || '',
      };
    })
    .sort((left, right) => (
      left.role.localeCompare(right.role, 'pt')
      || left.workLocation.localeCompare(right.workLocation, 'pt')
      || left.plannedCheckIn.localeCompare(right.plannedCheckIn)
      || left.collaborator.localeCompare(right.collaborator, 'pt')
      || String(left.sourceKey).localeCompare(String(right.sourceKey), 'pt')
    ))
    .map((row, index) => ({
      index: index + 1,
      collaborator: row.collaborator,
      nif: row.nif,
      role: row.role,
      workLocation: row.workLocation,
      plannedSchedule: row.plannedSchedule,
      actualCheckIn: '',
      actualCheckOut: '',
      signature: '',
      notes: '',
    }));
}

function thinBorder() {
  return {
    top: { style: 'thin', color: { rgb: COLORS.border } },
    bottom: { style: 'thin', color: { rgb: COLORS.border } },
    left: { style: 'thin', color: { rgb: COLORS.border } },
    right: { style: 'thin', color: { rgb: COLORS.border } },
  };
}

function applyCellStyle(sheet, XLSX, range, style) {
  const decoded = XLSX.utils.decode_range(range);
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let column = decoded.s.c; column <= decoded.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (!sheet[address]) sheet[address] = { t: 's', v: '' };
      sheet[address].s = style;
    }
  }
}

function merge(sheet, XLSX, range) {
  sheet['!merges'] ||= [];
  sheet['!merges'].push(XLSX.utils.decode_range(range));
}

function setCell(sheet, address, value, style) {
  sheet[address] = {
    t: typeof value === 'number' ? 'n' : 's',
    v: value,
    s: style,
  };
}

function metadataLabelStyle() {
  return {
    font: { bold: true, color: { rgb: COLORS.muted }, sz: 10 },
    fill: { fgColor: { rgb: COLORS.darkSoft } },
    alignment: { vertical: 'center' },
    border: thinBorder(),
  };
}

function metadataValueStyle() {
  return {
    font: { bold: true, color: { rgb: COLORS.white }, sz: 11 },
    fill: { fgColor: { rgb: COLORS.dark } },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder(),
  };
}

function eventLabel(event = {}) {
  return event.name || event.eventName || event.serviceName || 'Evento / Serviço';
}

function clientLabel(event = {}) {
  return event.client?.name || event.clientName || event.representativeName || 'Cliente não associado';
}

function eventLocation(event = {}) {
  return event.location || event.address || event.client?.address || '-';
}

export function createEventAttendanceWorkbook({
  XLSX,
  event = {},
  selectedDay = '',
  assignments = [],
  collaborators = [],
  workLocations = [],
} = {}) {
  if (!XLSX?.utils) throw new Error('O gerador Excel não está disponível.');

  const day = normalizeDateKey(selectedDay || event.date);
  const rows = buildEventAttendanceRows({
    assignments,
    collaborators,
    workLocations,
    selectedDay: day,
    isContinuous: Boolean(event.isContinuous),
  });
  if (!rows.length) throw new Error('Não existem colaboradores atribuídos ao dia selecionado.');

  const headerRowNumber = 8;
  const dataStartRowNumber = headerRowNumber + 1;
  const dataEndRowNumber = dataStartRowNumber + rows.length - 1;
  const fitToHeight = rows.length <= ATTENDANCE_PRINT.singlePageRowLimit ? 1 : 0;
  const aoa = Array.from({ length: dataEndRowNumber }, () => []);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  const titleStyle = {
    font: { bold: true, color: { rgb: COLORS.white }, sz: 16 },
    fill: { fgColor: { rgb: COLORS.dark } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: thinBorder(),
  };
  const brandStyle = {
    font: { bold: true, color: { rgb: COLORS.accent }, sz: 10 },
    fill: { fgColor: { rgb: COLORS.dark } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: thinBorder(),
  };
  const headerStyle = {
    font: { bold: true, color: { rgb: COLORS.white }, sz: 9 },
    fill: { fgColor: { rgb: COLORS.accentDark } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  };
  const rowStyle = {
    font: { color: { rgb: COLORS.dark }, sz: 9 },
    fill: { fgColor: { rgb: COLORS.white } },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder(),
  };
  const centeredRowStyle = {
    ...rowStyle,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };

  merge(sheet, XLSX, 'A1:J1');
  merge(sheet, XLSX, 'A2:J2');
  setCell(sheet, 'A1', 'Folha de Registo de Horas', titleStyle);
  setCell(sheet, 'A2', 'EXTRASOLUTIO  |  STAFF & EVENTOS', brandStyle);
  applyCellStyle(sheet, XLSX, 'A1:J1', titleStyle);
  applyCellStyle(sheet, XLSX, 'A2:J2', brandStyle);

  const dayLabel = `${formatDate(day)}${formatWeekday(day) ? ` · ${formatWeekday(day)}` : ''}`;
  const reference = String(event.serviceReference || event.budgetReference || '').trim() || '-';
  const metadata = [
    ['A4', 'Evento / Serviço', 'B4:D4', eventLabel(event), 'E4', 'Cliente', 'F4:J4', clientLabel(event)],
    ['A5', 'Data', 'B5:D5', dayLabel, 'E5', 'Local', 'F5:J5', eventLocation(event)],
    ['A6', 'Referência interna', 'B6:D6', reference, 'E6', 'Colaboradores', 'F6:J6', `${rows.length}`],
  ];

  for (const [labelAddress, label, valueRange, value, rightLabelAddress, rightLabel, rightValueRange, rightValue] of metadata) {
    const valueAddress = valueRange.split(':')[0];
    const rightValueAddress = rightValueRange.split(':')[0];
    merge(sheet, XLSX, valueRange);
    merge(sheet, XLSX, rightValueRange);
    setCell(sheet, labelAddress, label, metadataLabelStyle());
    setCell(sheet, valueAddress, value, metadataValueStyle());
    setCell(sheet, rightLabelAddress, rightLabel, metadataLabelStyle());
    setCell(sheet, rightValueAddress, rightValue, metadataValueStyle());
    applyCellStyle(sheet, XLSX, valueRange, metadataValueStyle());
    applyCellStyle(sheet, XLSX, rightValueRange, metadataValueStyle());
  }

  WORKBOOK_COLUMNS.forEach((column, index) => {
    const headerAddress = XLSX.utils.encode_cell({ r: headerRowNumber - 1, c: index });
    setCell(sheet, headerAddress, column.label, headerStyle);
  });

  rows.forEach((row, rowIndex) => {
    WORKBOOK_COLUMNS.forEach((column, columnIndex) => {
      const address = XLSX.utils.encode_cell({
        r: dataStartRowNumber - 1 + rowIndex,
        c: columnIndex,
      });
      const centered = ['index', 'nif', 'role', 'workLocation', 'plannedSchedule', 'actualCheckIn', 'actualCheckOut'].includes(column.key);
      setCell(sheet, address, row[column.key], centered ? centeredRowStyle : rowStyle);
    });
  });

  const confirmationStart = dataEndRowNumber + 2;
  merge(sheet, XLSX, `A${confirmationStart}:D${confirmationStart}`);
  merge(sheet, XLSX, `E${confirmationStart}:G${confirmationStart}`);
  merge(sheet, XLSX, `H${confirmationStart}:J${confirmationStart}`);
  setCell(sheet, `A${confirmationStart}`, 'Responsável da equipa', headerStyle);
  setCell(sheet, `E${confirmationStart}`, 'Responsável do cliente', headerStyle);
  setCell(sheet, `H${confirmationStart}`, 'Observações gerais', headerStyle);
  applyCellStyle(sheet, XLSX, `A${confirmationStart}:J${confirmationStart}`, headerStyle);

  const signatureEnd = confirmationStart + 2;
  merge(sheet, XLSX, `A${confirmationStart + 1}:D${signatureEnd}`);
  merge(sheet, XLSX, `E${confirmationStart + 1}:G${signatureEnd}`);
  merge(sheet, XLSX, `H${confirmationStart + 1}:J${signatureEnd}`);
  applyCellStyle(sheet, XLSX, `A${confirmationStart + 1}:J${signatureEnd}`, rowStyle);

  sheet['!ref'] = `A1:J${signatureEnd}`;
  sheet['!cols'] = WORKBOOK_COLUMNS.map((column) => ({ wch: column.width }));
  sheet['!rows'] = Array.from({ length: signatureEnd }, (_, index) => {
    if (index === 0) return { hpt: 22 };
    if (index === 1) return { hpt: 13 };
    if (index >= 3 && index <= 5) return { hpt: 15 };
    if (index === headerRowNumber - 1) return { hpt: 18 };
    if (index >= dataStartRowNumber - 1 && index <= dataEndRowNumber - 1) return { hpt: 18 };
    if (index === confirmationStart - 1) return { hpt: 18 };
    if (index >= confirmationStart && index < signatureEnd) return { hpt: 20 };
    return { hpt: 4 };
  });
  sheet['!autofilter'] = { ref: `A${headerRowNumber}:J${dataEndRowNumber}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: headerRowNumber, topLeftCell: `A${dataStartRowNumber}` };
  sheet['!margins'] = { ...ATTENDANCE_PRINT.margins };
  sheet['!pageSetup'] = {
    orientation: ATTENDANCE_PRINT.orientation,
    fitToWidth: ATTENDANCE_PRINT.fitToWidth,
    fitToHeight,
    paperSize: ATTENDANCE_PRINT.paperSize,
  };

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `Folha de Registo de Horas - ${eventLabel(event)}`,
    Subject: dayLabel,
    Author: 'ExtraSolutio',
    Company: 'ExtraSolutio',
    CreatedDate: new Date(),
  };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Registo de Horas');
  return { workbook, rows, sheet, fitToHeight };
}

// xlsx-js-style keeps these settings on the in-memory sheet but does not emit
// the corresponding OOXML nodes. Add them to the generated workbook so Excel
// applies the intended print layout instead of using its default scaling.
export async function applyAttendancePrintSettings(content, fitToHeight = 1) {
  const { unzipSync, zipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(content));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const source = files[sheetPath];
  if (!source) return content;

  const decoder = new globalThis.TextDecoder();
  const encoder = new globalThis.TextEncoder();
  let xml = decoder.decode(source);
  const sheetProperties = '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  const pageSetup = `<pageSetup orientation="${ATTENDANCE_PRINT.orientation}" paperSize="${ATTENDANCE_PRINT.paperSize}" fitToWidth="${ATTENDANCE_PRINT.fitToWidth}" fitToHeight="${fitToHeight}"/>`;

  if (xml.includes('<sheetPr')) {
    xml = xml.replace(/<sheetPr[\s\S]*?<\/sheetPr>/, sheetProperties);
  } else {
    xml = xml.replace(/(<worksheet[^>]*>)/, `$1${sheetProperties}`);
  }

  // pageSetup has a defined position in the worksheet schema: it must come
  // after pageMargins and before ignoredErrors/drawing elements. Appending it
  // at the end makes Excel repair the worksheet when opening the file.
  xml = xml.replace(/<pageSetup[^>]*\/>/, '');
  const pageMargins = xml.match(/<pageMargins\b[^>]*\/>/);
  if (pageMargins) {
    xml = xml.replace(pageMargins[0], `${pageMargins[0]}${pageSetup}`);
  } else if (xml.includes('</pageMargins>')) {
    xml = xml.replace('</pageMargins>', `</pageMargins>${pageSetup}`);
  } else if (xml.includes('<headerFooter')) {
    xml = xml.replace('<headerFooter', `${pageSetup}<headerFooter`);
  } else if (xml.includes('<ignoredErrors')) {
    xml = xml.replace('<ignoredErrors', `${pageSetup}<ignoredErrors`);
  } else {
    xml = xml.replace('</worksheet>', `${pageSetup}</worksheet>`);
  }

  files[sheetPath] = encoder.encode(xml);
  return zipSync(files, { level: 6 });
}

export function eventAttendanceFilename(event = {}, selectedDay = '') {
  const name = eventLabel(event)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Evento';
  const day = normalizeDateKey(selectedDay || event.date).replaceAll('-', '');
  return `Folha de Registo de Horas - ${name}${day ? ` - ${day}` : ''}.xlsx`;
}

export async function downloadEventAttendanceExcel(options = {}) {
  const imported = await import('xlsx-js-style');
  const XLSX = imported.default || imported;
  const { workbook, fitToHeight } = createEventAttendanceWorkbook({ ...options, XLSX });
  const rawContent = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    compression: true,
    cellStyles: true,
  });
  const content = await applyAttendancePrintSettings(rawContent, fitToHeight);
  const blob = new window.Blob(
    [content],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = eventAttendanceFilename(options.event, options.selectedDay);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
