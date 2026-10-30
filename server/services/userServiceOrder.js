import { emptyServiceOrder, validServiceOrder } from '../../src/utils/serviceOrder.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
function presentation(row) {
  if (!row) return emptyServiceOrder();
  try {
    const value = { mode: row.mode, ids: JSON.parse(row.orderedIds), version: row.version };
    if (validServiceOrder(value)) return value;
  } catch { /* A malformed cosmetic preference must not break the service list. */ }
  return { ...emptyServiceOrder(), version: row.version };
}

export async function readUserServiceOrder(db, user) {
  const rows = await db.userServiceOrder.findMany({ where: { userId: user.id } });
  return Object.fromEntries(['active', 'archive'].map((scope) => [scope, presentation(rows.find((row) => row.scope === scope))]));
}

export async function updateUserServiceOrder(db, user, scope, input) {
  if (!['active', 'archive'].includes(scope) || !validServiceOrder(input)) throw fail('Ordem de eventos inválida.');
  const existing = await db.event.findMany({ where: { id: { in: input.ids } }, select: { id: true } });
  const allowed = new Set(existing.map((event) => event.id));
  const ids = input.ids.filter((id) => allowed.has(id));
  const data = { mode: input.mode, orderedIds: JSON.stringify(ids), version: input.version + 1 };
  const conflict = () => fail('A ordem foi alterada noutro separador ou dispositivo. A lista foi atualizada; volta a tentar.', 409);
  if (input.version === 0) {
    try { return presentation(await db.userServiceOrder.create({ data: { userId: user.id, scope, ...data } })); }
    catch (error) { if (error.code === 'P2002') throw conflict(); throw error; }
  }
  // Compare-and-swap prevents a stale tab from overwriting a newer personal order.
  const updated = await db.userServiceOrder.updateMany({ where: { userId: user.id, scope, version: input.version }, data });
  if (updated.count !== 1) throw conflict();
  return { mode: data.mode, ids, version: data.version };
}
