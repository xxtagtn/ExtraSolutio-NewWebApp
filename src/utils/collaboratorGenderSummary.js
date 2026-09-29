const femaleValues = new Set(['feminino', 'female']);
const maleValues = new Set(['masculino', 'male']);
const preferNotValues = new Set(['prefiro não indicar', 'prefiro nao indicar']);

export function buildCollaboratorGenderSummary(groups = []) {
  const summary = {
    total: 0,
    women: 0,
    men: 0,
    other: 0,
    preferNot: 0,
    unspecified: 0,
  };

  for (const group of groups) {
    const count = Math.max(0, Number(group?._count?.id) || 0);
    const gender = String(group?.gender || '').trim().toLocaleLowerCase('pt-PT');
    summary.total += count;

    if (femaleValues.has(gender)) summary.women += count;
    else if (maleValues.has(gender)) summary.men += count;
    else if (preferNotValues.has(gender)) summary.preferNot += count;
    else if (gender) summary.other += count;
    else summary.unspecified += count;
  }

  return summary;
}
