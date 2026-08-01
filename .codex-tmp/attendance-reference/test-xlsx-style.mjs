import * as XLSX from 'xlsx';

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet([
  ['Folha de Registo de Horas'],
  ['Evento', 'Teste'],
  ['Colaborador', 'Entrada real'],
  ['Ana Silva', ''],
]);

worksheet['!merges'] = [XLSX.utils.decode_range('A1:B1')];
worksheet['!cols'] = [{ wch: 28 }, { wch: 18 }];
worksheet.A1.s = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 18 },
  fill: { patternType: 'solid', fgColor: { rgb: '0F766E' } },
  alignment: { horizontal: 'center' },
};
worksheet.A3.s = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '111827' } },
};

XLSX.utils.book_append_sheet(workbook, worksheet, 'Registo');
XLSX.writeFile(workbook, '.codex-tmp/attendance-reference/output/style-test.xlsx', {
  cellStyles: true,
});
