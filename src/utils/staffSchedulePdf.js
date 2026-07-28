import { effectiveRowDateKey, effectiveRowStartTime } from './timeValidationFilters.js';
import { durationHours } from './formatters.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function formatTime(value) {
  return value || '--:--';
}

function formatHours(value) {
  return durationHours(value);
}

function formatHoursCell(value) {
  return durationHours(value);
}

function formatMoney(value) {
  const parsed = Number(value || 0);
  return `${(Number.isFinite(parsed) ? parsed : 0).toFixed(2).replace('.', ',')}€`;
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value)
    .replace(/€/g, '')
    .replace(/\b(?:eur|euros?)\b/gi, '')
    .replace(/\s/g, '')
    .trim();
  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRequiredRoles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clientRateForRole(event, role) {
  const required = parseRequiredRoles(event?.requiredRoles).find((item) => item?.role === role);
  return parseMoney(required?.agreedRate ?? required?.rate);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowSortValue(row) {
  return [
    new Date(effectiveRowDateKey(row) || 0).getTime(),
    effectiveRowStartTime(row),
    String(row?.event?.name || ''),
    String(row?.assignment?.collaborator?.shortName || row?.assignment?.collaborator?.name || ''),
  ].join('|');
}

export function buildStaffScheduleRows(rows) {
  return [...(rows || [])]
    .filter((row) => row?.event && row?.assignment)
    .sort((a, b) => rowSortValue(a).localeCompare(rowSortValue(b), 'pt'))
    .map((row) => {
      const hours = Number(row.staffScheduleHours ?? row.staffHours ?? 0);
      const billableHours = Number(row.clientHours ?? hours);
      const rate = clientRateForRole(row.event, row.assignment.role);
      return {
        eventId: row.event.id,
        eventName: row.event.name || '-',
        clientName: row.event.client?.name || row.event.clientName || '-',
        eventDate: formatDate(effectiveRowDateKey(row)),
        location: row.event.location || '-',
        collaboratorName: row.assignment.collaborator?.shortName || row.assignment.collaborator?.name || '-',
        role: row.assignment.role || '-',
        workLocationsEnabled: Boolean(row.event.workLocationsEnabled),
        workLocationName: row.event.workLocationsEnabled
          ? (row.assignment.workLocation?.name || '-')
          : '',
        checkIn: formatTime(row.assignment.checkIn),
        checkOut: formatTime(row.assignment.checkOut),
        hours,
        rate,
        totalValue: Number((billableHours * rate).toFixed(2)),
        notes: row.assignment.validationNotes || '',
      };
    });
}

function groupByEvent(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.eventId ? `${row.eventId}-${row.eventDate}` : `${row.eventName}-${row.eventDate}`);
    if (!map.has(key)) {
      map.set(key, {
        eventId: row.eventId,
        eventName: row.eventName,
        clientName: row.clientName,
        eventDate: row.eventDate,
        location: row.location,
        workLocationsEnabled: row.workLocationsEnabled,
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}

export function buildStaffSchedulePdfHtml(rows, options = {}) {
  const scheduleRows = buildStaffScheduleRows(rows);
  const groups = groupByEvent(scheduleRows);
  const showWorkLocation = scheduleRows.some((row) => row.workLocationsEnabled);
  const generatedAt = options.generatedAt || new Date();
  const generatedAtLabel = new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(generatedAt);
  const totalHours = scheduleRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const totalValue = scheduleRows.reduce((sum, row) => sum + Number(row.totalValue || 0), 0);

  const sections = groups.map((group) => {
    const groupValue = group.rows.reduce((sum, row) => sum + Number(row.totalValue || 0), 0);
    return `
    <section class="event-block">
      <header>
        <div>
          <span>Evento/Serviço</span>
          <strong>${escapeHtml(group.eventName)}</strong>
        </div>
        <div>
          <span>Cliente</span>
          <strong>${escapeHtml(group.clientName)}</strong>
        </div>
        <div>
          <span>Data</span>
          <strong>${escapeHtml(group.eventDate)}</strong>
        </div>
        <div>
          <span>Local</span>
          <strong>${escapeHtml(group.location)}</strong>
        </div>
        <div>
          <span>Valor total</span>
          <strong>${escapeHtml(formatMoney(groupValue))}</strong>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            ${showWorkLocation ? '<th>Local de Trabalho</th>' : ''}
            <th>Função</th>
            <th>Entrada Staff</th>
            <th>Saída Staff</th>
            <th>Total</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${group.rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.collaboratorName)}</td>
              ${showWorkLocation ? `<td>${escapeHtml(row.workLocationName || '-')}</td>` : ''}
              <td>${escapeHtml(row.role)}</td>
              <td>${escapeHtml(row.checkIn)}</td>
              <td>${escapeHtml(row.checkOut)}</td>
              <td>${escapeHtml(formatHours(row.hours))}</td>
              <td>${escapeHtml(row.notes || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
  }).join('');

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <title>Horários Staff</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      background: #ffffff;
      font: 12px/1.45 Arial, sans-serif;
    }
    .page {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px;
    }
    .report-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
      padding-bottom: 16px;
      border-bottom: 2px solid #111827;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
      letter-spacing: 0;
    }
    .report-header p,
    .report-meta span,
    .event-block header span {
      margin: 0;
      color: #6b7280;
      font-size: 11px;
      text-transform: uppercase;
    }
    .report-meta {
      display: grid;
      gap: 6px;
      min-width: 220px;
      text-align: right;
    }
    .report-meta strong,
    .event-block header strong {
      display: block;
      color: #111827;
      font-size: 13px;
    }
    .event-block {
      break-inside: avoid;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .event-block header {
      display: grid;
      grid-template-columns: minmax(180px, 1.4fr) minmax(150px, 1fr) 110px minmax(140px, 1fr) 110px;
      gap: 10px;
      padding: 12px;
      background: #f3f4f6;
      border-bottom: 1px solid #d1d5db;
    }
    .summary-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .summary-row div {
      border: 1px solid #bae6fd;
      border-radius: 8px;
      background: #e0f2fe;
      color: #075985;
      padding: 10px 12px;
    }
    .summary-row span {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
    }
    .summary-row strong {
      display: block;
      margin-top: 4px;
      color: #0c4a6e;
      font-size: 15px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #374151;
      background: #fafafa;
      font-size: 10px;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    .empty {
      padding: 28px;
      border: 1px dashed #d1d5db;
      color: #6b7280;
      text-align: center;
    }
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      .page { padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="report-header">
      <div>
        <h1>Horários registados pelo Staff</h1>
        <p>Relatório para envio ao cliente</p>
      </div>
      <div class="report-meta">
        <div><span>Cliente</span><strong>${escapeHtml(options.clientLabel || 'Todos os clientes')}</strong></div>
        <div><span>Período</span><strong>${escapeHtml(options.monthLabel || options.periodLabel || '-')}</strong></div>
        <div><span>Gerado em</span><strong>${escapeHtml(generatedAtLabel)}</strong></div>
      </div>
    </header>
    <section class="summary-row">
      <div><span>Total geral de horas Staff</span><strong>${escapeHtml(formatHours(totalHours))}</strong></div>
      <div><span>Valor total dos serviços</span><strong>${escapeHtml(formatMoney(totalValue))}</strong></div>
    </section>
    ${sections || '<div class="empty">Sem horários Staff registados para os filtros selecionados.</div>'}
  </main>
</body>
</html>`;
}

export function buildStaffScheduleCsv(rows) {
  const scheduleRows = buildStaffScheduleRows(rows);
  const showWorkLocation = scheduleRows.some((row) => row.workLocationsEnabled);
  const headers = [
    'Cliente',
    'Evento/Serviço',
    'Data',
    'Local',
    'Colaborador',
    ...(showWorkLocation ? ['Local de Trabalho'] : []),
    'Função',
    'Entrada Staff',
    'Saída Staff',
    'Total horas',
    'Valor/h',
    'Valor total',
    'Notas',
  ];
  const lines = [
    headers.map(csvCell).join(';'),
    ...scheduleRows.map((row) => [
      row.clientName,
      row.eventName,
      row.eventDate,
      row.location,
      row.collaboratorName,
      ...(showWorkLocation ? [row.workLocationName || '-'] : []),
      row.role,
      row.checkIn,
      row.checkOut,
      formatHoursCell(row.hours),
      formatMoney(row.rate),
      formatMoney(row.totalValue),
      row.notes || '',
    ].map(csvCell).join(';')),
  ];
  return `\uFEFF${lines.join('\n')}`;
}

export function buildStaffScheduleExcelHtml(rows, options = {}) {
  const scheduleRows = buildStaffScheduleRows(rows);
  const groups = groupByEvent(scheduleRows);
  const showWorkLocation = scheduleRows.some((row) => row.workLocationsEnabled);
  const columnCount = showWorkLocation ? 11 : 10;
  const totalLabelColumnCount = columnCount - 2;
  const generatedAt = options.generatedAt || new Date();
  const generatedAtLabel = new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(generatedAt);
  const totalHours = scheduleRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const totalValue = scheduleRows.reduce((sum, row) => sum + Number(row.totalValue || 0), 0);

  const groupRows = groups.map((group) => {
    const groupHours = group.rows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const groupValue = group.rows.reduce((sum, row) => sum + Number(row.totalValue || 0), 0);
    return `
      <tr class="event-title">
        <td colspan="${columnCount}">${escapeHtml(group.eventName)}</td>
      </tr>
      <tr class="event-meta">
        <td colspan="2"><strong>Cliente</strong><br>${escapeHtml(group.clientName)}</td>
        <td colspan="2"><strong>Data</strong><br>${escapeHtml(group.eventDate)}</td>
        <td colspan="3"><strong>Local</strong><br>${escapeHtml(group.location)}</td>
        <td colspan="${showWorkLocation ? 3 : 2}"><strong>Total horas</strong><br>${escapeHtml(formatHours(groupHours))}</td>
        <td><strong>Valor total</strong><br>${escapeHtml(formatMoney(groupValue))}</td>
      </tr>
      <tr class="table-head">
        <td>Cliente</td>
        <td>Evento/Serviço</td>
        <td>Data</td>
        <td>Local</td>
        <td>Colaborador</td>
        ${showWorkLocation ? '<td>Local de Trabalho</td>' : ''}
        <td>Função</td>
        <td>Entrada Staff</td>
        <td>Saída Staff</td>
        <td>Total horas</td>
        <td>Notas</td>
      </tr>
      ${group.rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.clientName)}</td>
          <td>${escapeHtml(row.eventName)}</td>
          <td>${escapeHtml(row.eventDate)}</td>
          <td>${escapeHtml(row.location)}</td>
          <td>${escapeHtml(row.collaboratorName)}</td>
          ${showWorkLocation ? `<td>${escapeHtml(row.workLocationName || '-')}</td>` : ''}
          <td>${escapeHtml(row.role)}</td>
          <td class="time-cell">${escapeHtml(row.checkIn)}</td>
          <td class="time-cell">${escapeHtml(row.checkOut)}</td>
          <td class="number-cell">${escapeHtml(formatHoursCell(row.hours))}</td>
          <td>${escapeHtml(row.notes || '-')}</td>
        </tr>
      `).join('')}
      <tr class="event-total">
        <td colspan="${totalLabelColumnCount}">Total evento</td>
        <td class="number-cell">${escapeHtml(formatHoursCell(groupHours))}</td>
        <td class="money-cell">${escapeHtml(formatMoney(groupValue))}</td>
      </tr>
      <tr class="spacer"><td colspan="${columnCount}"></td></tr>
    `;
  }).join('');

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <meta name="ProgId" content="Excel.Sheet" />
  <meta name="Generator" content="ExtraSolutio" />
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #111827;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    td {
      border: 1px solid #d1d5db;
      padding: 7px 9px;
      vertical-align: top;
      mso-number-format: "\\@";
    }
    .report-title td {
      background: #111827;
      color: #ffffff;
      font-size: 18px;
      font-weight: 700;
      border-color: #111827;
      padding: 12px;
    }
    .report-meta td {
      background: #f3f4f6;
      color: #374151;
      font-size: 11px;
    }
    .report-total td {
      background: #e0f2fe;
      color: #075985;
      font-size: 13px;
      font-weight: 700;
    }
    .event-title td {
      background: #0f766e;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      border-color: #0f766e;
    }
    .event-meta td {
      background: #ecfeff;
      color: #164e63;
    }
    .table-head td {
      background: #e5e7eb;
      color: #374151;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .number-cell,
    .money-cell {
      text-align: right;
      mso-number-format: "0.00";
    }
    .time-cell {
      text-align: center;
    }
    .event-total td {
      background: #f9fafb;
      font-weight: 700;
    }
    .spacer td {
      height: 14px;
      border-left: 0;
      border-right: 0;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <table>
    <colgroup>
      <col style="width: 180px" />
      <col style="width: 220px" />
      <col style="width: 90px" />
      <col style="width: 180px" />
      <col style="width: 180px" />
      ${showWorkLocation ? '<col style="width: 150px" />' : ''}
      <col style="width: 120px" />
      <col style="width: 85px" />
      <col style="width: 85px" />
      <col style="width: 85px" />
      <col style="width: 260px" />
    </colgroup>
    <tr class="report-title">
      <td colspan="${columnCount}">Horários registados pelo Staff</td>
    </tr>
    <tr class="report-meta">
      <td colspan="3"><strong>Cliente</strong><br>${escapeHtml(options.clientLabel || 'Todos os clientes')}</td>
      <td colspan="3"><strong>Período</strong><br>${escapeHtml(options.periodLabel || options.monthLabel || '-')}</td>
      <td colspan="2"><strong>Gerado em</strong><br>${escapeHtml(generatedAtLabel)}</td>
      <td colspan="${showWorkLocation ? 3 : 2}"><strong>Registos</strong><br>${scheduleRows.length}</td>
    </tr>
    <tr class="report-total">
      <td colspan="${totalLabelColumnCount}">Total geral de horas Staff</td>
      <td class="number-cell">${escapeHtml(formatHoursCell(totalHours))}</td>
      <td class="money-cell"><strong>Valor total dos serviços</strong><br>${escapeHtml(formatMoney(totalValue))}</td>
    </tr>
    <tr class="spacer"><td colspan="${columnCount}"></td></tr>
    ${groupRows || `<tr><td colspan="${columnCount}">Sem horários Staff registados para os filtros selecionados.</td></tr>`}
  </table>
</body>
</html>`;
}
