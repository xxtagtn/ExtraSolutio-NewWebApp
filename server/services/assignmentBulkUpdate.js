function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

export async function updateAssignmentsInBulk({
  prisma,
  updates,
  include,
  normalizeUpdate,
  synchronizeEvent,
}) {
  if (!Array.isArray(updates) || !updates.length) {
    throw httpError('Indica pelo menos uma linha para atualizar.', 400);
  }

  const normalizedRequests = updates.map((item) => ({
    id: Number(item?.id),
    data: item?.data,
  }));
  if (normalizedRequests.some((item) => !Number.isInteger(item.id) || item.id <= 0 || !item.data || typeof item.data !== 'object')) {
    throw httpError('Existem linhas inválidas no pedido de atualização.', 400);
  }

  const ids = normalizedRequests.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw httpError('A mesma linha não pode ser atualizada mais do que uma vez.', 400);
  }

  const existingRows = await prisma.eventAssignment.findMany({ where: { id: { in: ids } } });
  const existingById = new Map(existingRows.map((row) => [Number(row.id), row]));
  if (existingRows.length !== ids.length) {
    throw httpError('Uma ou mais linhas já não existem.', 404);
  }

  const prepared = [];
  for (const request of normalizedRequests) {
    const existing = existingById.get(request.id);
    prepared.push({
      ...request,
      existing,
      data: await normalizeUpdate(request.data, existing),
    });
  }

  const eventIds = new Set(
    prepared
      .map((item) => Number(item.existing?.eventId))
      .filter((eventId) => Number.isInteger(eventId) && eventId > 0),
  );

  const rows = await prisma.$transaction(async (tx) => {
    const result = [];
    for (const item of prepared) {
      const row = await tx.eventAssignment.update({
        where: { id: item.id },
        data: item.data,
        include,
      });
      result.push(row);
      const eventId = Number(row.eventId);
      if (Number.isInteger(eventId) && eventId > 0) eventIds.add(eventId);
    }

    for (const eventId of eventIds) await synchronizeEvent(eventId, tx);
    return result;
  });

  return rows;
}
