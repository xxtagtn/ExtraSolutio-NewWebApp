export function filterCollaborators(rows, filters = {}) {
  const {
    nameFilter = '',
    roleFilter = '',
    statusFilter = '',
    ownCarOnly = false,
  } = filters;
  const normalizedName = String(nameFilter || '').trim().toLowerCase();

  return (rows || []).filter((row) => {
    const byName = normalizedName
      ? String(row.name || '').toLowerCase().includes(normalizedName)
      : true;
    const byRole = roleFilter ? (row.roles || []).includes(roleFilter) : true;
    const byStatus = statusFilter ? row.status === statusFilter : true;
    const byOwnCar = ownCarOnly ? Boolean(row.hasOwnCar) : true;
    return byName && byRole && byStatus && byOwnCar;
  });
}
