import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const sourcePath = process.argv[2] || 'C:/Users/Myser PC/Downloads/folha de registo de horas (1).xlsx';
const outputName = process.argv[3] || 'reference.png';
const outputDir = path.resolve('.codex-tmp/attendance-reference/output');

await fs.mkdir(outputDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const workbookInspection = await workbook.inspect({
  kind: 'workbook',
  include: 'id,name',
  tableMaxRows: 100,
  tableMaxCols: 30,
  maxChars: 20000,
});

console.log('WORKBOOK');
console.log(workbookInspection.ndjson);

const firstSheet = workbook.worksheets.getItemAt(0);
console.log(`FIRST_SHEET=${firstSheet.name}`);

const regionInspection = await workbook.inspect({
  kind: 'table',
  range: `${firstSheet.name}!A1:Z80`,
  include: 'values,formulas',
  tableMaxRows: 80,
  tableMaxCols: 26,
  maxChars: 30000,
});

console.log('REGION');
console.log(regionInspection.ndjson);

const styleInspection = await workbook.inspect({
  kind: 'computedStyle',
  range: `${firstSheet.name}!A1:Z40`,
  include: 'styles',
  tableMaxRows: 40,
  tableMaxCols: 26,
  maxChars: 30000,
});

console.log('STYLES');
console.log(styleInspection.ndjson);

const renderBlob = await workbook.render({
  sheetName: firstSheet.name,
  autoCrop: 'all',
  scale: 1.5,
  format: 'png',
});

await fs.writeFile(
  path.join(outputDir, outputName),
  new Uint8Array(await renderBlob.arrayBuffer()),
);
