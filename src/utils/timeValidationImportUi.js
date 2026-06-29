function count(value) {
  return Number(value || 0);
}

export function isExcelImportFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return /\.(xlsx|xls|xlsm)$/.test(name);
}

export function canConfirmTimeValidationImport(preview, busy = false) {
  return Boolean(count(preview?.summary?.validRows) > 0 && !busy);
}

export function importConfirmationMessage(preview) {
  const validRows = count(preview?.summary?.validRows);
  const invalidRows = count(preview?.summary?.invalidRows);
  if (!validRows) return 'Sem linhas válidas para importar.';
  if (invalidRows) {
    return `${validRows} linha(s) serão gravadas. ${invalidRows} linha(s) inválida(s) ficarão por importar.`;
  }
  return `${validRows} linha(s) serão gravadas.`;
}

export function importResultMessage(result) {
  const imported = count(result?.imported);
  const skipped = count(result?.skipped);
  if (skipped) return `${imported} registo(s) importado(s). ${skipped} registo(s) ignorado(s).`;
  return `${imported} registo(s) importado(s).`;
}
