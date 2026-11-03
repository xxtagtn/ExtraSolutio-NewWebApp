import { billingToday } from '../../shared/clientBillingCalendar.js';
import { invoiceIsIssued } from '../../shared/invoiceLifecycle.js';
import { paymentInvoiceEventIds } from '../../shared/invoicePaymentCoverage.js';
import { sumMoney } from '../../shared/money.js';
import { clientFinancialState } from './clientFinancialState.js';
import { clientPaymentTax } from './clientPaymentTotal.js';
import { activeEventAssignments, assignmentEventDay, eventDayKey } from './eventCancelledDays.js';
import { billableEventAssignments } from './eventFinancialRules.js';
import { isFinanceReadyEvent } from './financeReadiness.js';
import { isExternalOnlyService } from './externalServiceWorkflow.js';
import { clientChargeHours, staffWorkedHours } from './serviceFinance.js';
import { applyAttendancePrintSettings } from './eventAttendanceExcel.js';

const staffRows = (event) => billableEventAssignments(activeEventAssignments(event))
  .filter((row) => row.collaboratorId || row.collaborator?.id);
const clientTimes = (row) => row.validatedCheckIn && row.validatedCheckOut
  ? [row.validatedCheckIn, row.validatedCheckOut] : [row.clientCheckIn, row.clientCheckOut];
const hasValidatedHours = (row) => row.validationStatus === 'validated'
  && row.checkIn && row.checkOut && clientTimes(row).every(Boolean);
const clock = (value) => String(value || '').slice(0, 5);
const dateFormat = (value) => eventDayKey(value)?.split('-').reverse().join('/') || '';
const duration = (hours) => Math.round(hours * 60) / 1440;
const currency = '#,##0.00" €"';

export function canExportArchivedEvent(event, now = new Date()) {
  if (!event || !isFinanceReadyEvent(event) || clientFinancialState(event).status !== 'paid') return false;
  const end = eventDayKey(event.isContinuous ? event.endDate || event.date : event.date);
  if (!end || end >= billingToday(now)) return false;
  const rows = staffRows(event);
  return rows.length
    ? rows.every(hasValidatedHours)
    : isExternalOnlyService(event);
}

export function createArchiveEventWorkbook(events, XLSX, { archived = true } = {}) {
  const selected = [...new Map(events.map((event) => [String(event.id), event])).values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
  if (!selected.length) throw new Error('Seleciona pelo menos um evento.');
  const single = selected.length === 1;
  let collaboratorCount = 0;
  const summary = [], schedules = [], invoices = new Map();
  for (const event of selected) {
    const name = event.name || 'Evento/Serviço';
    const financial = clientFinancialState(event);
    const rows = staffRows(event).filter(hasValidatedHours)
      .sort((a, b) => assignmentEventDay(a, event).localeCompare(assignmentEventDay(b, event)));
    collaboratorCount += new Set(rows.map((row) => String(row.collaboratorId || row.collaborator.id))).size;
    let staff = 0, billed = 0;
    for (const row of rows) {
      const staffTime = duration(staffWorkedHours(row));
      const billedTime = duration(clientChargeHours(row, '', '', event.minimumHoursSnapshot));
      staff += staffTime; billed += billedTime;
      schedules.push([...(single ? [] : [name]), row.collaborator?.name || row.collaboratorName || '', row.role || '',
        dateFormat(assignmentEventDay(row, event)), clock(row.checkIn), clock(row.checkOut), staffTime,
        ...clientTimes(row).map(clock), billedTime, row.validationNotes || '']);
    }
    const tax = clientPaymentTax(event);
    summary.push([name, event.client?.name || event.clientName || '', dateFormat(event.date),
      dateFormat(event.endDate || event.date), staff, billed, financial.total, financial.received,
      financial.outstanding, dateFormat(event.billingPaymentDate), sumMoney(financial.total, -tax), tax]);
    for (const invoice of event.invoices || []) {
      if (invoiceIsIssued(invoice) && paymentInvoiceEventIds(invoice).length > 1) invoices.set(invoice.id, invoice);
    }
  }
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);
  const widths = single ? [27, 17, 14, 14, 14, 14, 16, 15, 17, 25] : [31, 24, 16, 15, 14, 16, 16, 16, 14, 19, 23, 14];
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!merges'] = [];
  sheet['!rows'] = [];
  let cursor = 0;
  const border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map((side) => [side, { style: 'thin', color: { rgb: 'A6A6A6' } }]));
  function row(values, { fill = 'FFFFFF', bold = false, color = '111111', size = 11, height = 19, spans, formats = {}, center = false } = {}) {
    XLSX.utils.sheet_add_aoa(sheet, [Array(widths.length).fill('')], { origin: { r: cursor, c: 0 } });
    sheet['!rows'][cursor] = { hpt: height };
    for (let c = 0; c < widths.length; c++) {
      sheet[XLSX.utils.encode_cell({ r: cursor, c })].s = {
        font: { name: 'Calibri', sz: size, bold, color: { rgb: color } },
        fill: { patternType: 'solid', fgColor: { rgb: fill } },
        alignment: { vertical: 'center', horizontal: center ? 'center' : undefined, wrapText: true },
        border,
      };
    }
    let col = 0;
    values.forEach((value, index) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: cursor, c: col })];
      Object.assign(cell, typeof value === 'object' ? value : { t: typeof value === 'number' ? 'n' : 's', v: value });
      if (formats[index]) cell.z = formats[index];
      const span = spans?.[index] || 1;
      if (span > 1) sheet['!merges'].push({ s: { r: cursor, c: col }, e: { r: cursor, c: col + span - 1 } });
      col += span;
    });
    cursor++;
  }
  const band = (label) => row([label], { fill: '595959', color: 'FFFFFF', bold: true, size: 14, height: 26, spans: [widths.length], center: true });
  const headersStyle = { fill: 'D9D9D9', bold: true, height: 28, center: true };
  function table(headers, rows, formats, totalLabel, filter = false) {
    const header = cursor;
    row(headers, headersStyle);
    rows.forEach((values, index) => row(values, { formats, fill: index % 2 ? 'F2F2F2' : 'FFFFFF' }));
    if (!rows.length) {
      row([archived ? 'Sem horários de Staff' : 'Sem horários validados'], { spans: [widths.length] });
      return;
    }
    if (filter) sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: header, c: 0 }, { r: cursor - 1, c: headers.length - 1 }) };
    const totals = headers.map((_, index) => {
      if (index === 0) return totalLabel;
      if (!formats[index]) return '';
      const values = rows.map((values) => values[index]);
      const letter = XLSX.utils.encode_col(index);
      return { t: 'n', f: `SUBTOTAL(109,${letter}${header + 2}:${letter}${cursor})`,
        v: formats[index] === currency ? sumMoney(...values) : values.reduce((sum, value) => sum + value, 0) };
    });
    row(totals, { fill: 'E2E2E2', bold: true, formats });
  }
  band(single ? 'EXTRASOLUTIO | RESUMO DO EVENTO' : 'EXTRASOLUTIO | RESUMO DOS EVENTOS');
  if (single) {
    const [name, client, start, end, staff, billed, total, received, balance, payment] = summary[0];
    row([name], { fill: 'E2E2E2', bold: true, size: 16, height: 25, spans: [10], center: true });
    row([`Cliente: ${client || '-'}`, `Data: ${start === end ? start : start + ' a ' + end}`,
      `Estado: ${archived ? 'Arquivado' : clientFinancialState(selected[0]).label}`, `Pagamento: ${payment || '-'}`],
      { spans: [3, 3, 2, 2], height: 28 });
    const spans = [2, 2, 2, 2, 1, 1];
    row(['Colaboradores', 'Horas staff', 'Horas faturáveis', 'Total c/ IVA', 'Recebido', 'Saldo'], { ...headersStyle, spans });
    row([collaboratorCount, staff, billed, total, received, balance], { spans, center: true,
      formats: { 1: '[h]:mm', 2: '[h]:mm', 3: currency, 4: currency, 5: currency } });
  } else {
    row([`${selected.length} eventos ${archived ? 'arquivados' : 'selecionados'}`], { fill: 'E2E2E2', bold: true, height: 25, spans: [12], center: true });
    table(['Evento/Serviço', 'Cliente', 'Data inicial', 'Data final', 'Horas staff', 'Horas faturáveis', 'Total c/ IVA', 'Recebido', 'Saldo', 'Pagamento', 'Sem IVA', 'IVA'],
      summary, { 4: '[h]:mm', 5: '[h]:mm', 6: currency, 7: currency, 8: currency, 10: currency, 11: currency }, 'Totais dos serviços');
  }
  cursor++;
  band('HORÁRIOS VALIDADOS');
  const offset = single ? 0 : 1;
  table([...(single ? [] : ['Evento/Serviço']), 'Colaborador', 'Função', 'Data', 'Entrada staff', 'Saída staff', 'Horas staff', 'Entrada cliente', 'Saída cliente', 'Horas faturáveis', 'Notas'],
    schedules, { [5 + offset]: '[h]:mm', [8 + offset]: '[h]:mm' }, 'Total', true);
  cursor++;
  for (const [label, col] of [['Sem IVA', 10], ['IVA', 11], ['Total com IVA', 6]]) {
    row([label, sumMoney(...summary.map((values) => values[col]))], { fill: 'EAEAEA', bold: label === 'Total com IVA', formats: { 1: currency } });
  }
  if (invoices.size) {
    const selectedIds = new Set(selected.map((event) => Number(event.id)));
    cursor++;
    band('FATURAS AGRUPADAS · VALORES INTEGRAIS');
    row(['Fatura', 'Eventos selecionados / total', 'Valor da fatura'], { ...headersStyle, spans: [2, 2, 2] });
    for (const invoice of invoices.values()) {
      const ids = paymentInvoiceEventIds(invoice);
      row([invoice.number || String(invoice.id), `${ids.filter((id) => selectedIds.has(id)).length} / ${ids.length}`, Number(invoice.total)],
        { spans: [2, 2, 2], formats: { 2: currency } });
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, single ? 'Resumo do evento' : 'Resumo dos eventos');
  return workbook;
}

export async function downloadArchiveEventExcel(events, options) {
  const imported = await import('xlsx-js-style');
  const XLSX = imported.default || imported;
  const workbook = createArchiveEventWorkbook(events, XLSX, options);
  const name = events.length === 1 ? String(events[0].name || 'Evento').replace(/[<>:"/\\|?*]/g, ' ').trim().slice(0, 80) : `${events.length} eventos`;
  const raw = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true, cellStyles: true });
  const content = await applyAttendancePrintSettings(raw, 0);
  const url = window.URL.createObjectURL(new window.Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Resumo - ${name || 'Evento'}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
