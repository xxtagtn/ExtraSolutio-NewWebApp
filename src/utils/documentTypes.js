const DOCUMENT_TYPE_LABELS = {
  passport: 'Passaporte',
  citizen_card: 'Cartão de Cidadão',
  residence_permit: 'Título de Residência',
  residence_title: 'Título de Residência',
};

export function documentTypeLabel(type) {
  return DOCUMENT_TYPE_LABELS[type] || type || 'Documento';
}
