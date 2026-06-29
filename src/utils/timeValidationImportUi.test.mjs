import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canConfirmTimeValidationImport,
  importConfirmationMessage,
  importResultMessage,
  isExcelImportFile,
} from './timeValidationImportUi.js';

test('allows confirming an import when valid rows exist even if some rows are invalid', () => {
  assert.equal(canConfirmTimeValidationImport({
    summary: { validRows: 3, invalidRows: 2 },
  }), true);
});

test('does not allow confirming an import with no valid rows or while busy', () => {
  assert.equal(canConfirmTimeValidationImport({
    summary: { validRows: 0, invalidRows: 2 },
  }), false);
  assert.equal(canConfirmTimeValidationImport({
    summary: { validRows: 3, invalidRows: 0 },
  }, true), false);
});

test('describes partial imports clearly', () => {
  assert.equal(
    importConfirmationMessage({ summary: { validRows: 3, invalidRows: 2 } }),
    '3 linha(s) serão gravadas. 2 linha(s) inválida(s) ficarão por importar.',
  );
  assert.equal(
    importResultMessage({ imported: 3, skipped: 2 }),
    '3 registo(s) importado(s). 2 registo(s) ignorado(s).',
  );
});

test('accepts only Excel files for time validation import', () => {
  assert.equal(isExcelImportFile({ name: 'Relatorio.xlsx' }), true);
  assert.equal(isExcelImportFile({ name: 'Relatorio.XLS' }), true);
  assert.equal(isExcelImportFile({ name: 'Relatorio.xlsm' }), true);
  assert.equal(isExcelImportFile({ name: 'Relatorio.csv' }), false);
  assert.equal(isExcelImportFile({ name: 'Relatorio.pdf' }), false);
});
