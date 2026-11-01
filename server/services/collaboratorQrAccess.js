export function qrPageNotFound() {
  return Object.assign(new Error('Este endereço não está disponível.'), {
    statusCode: 404, code: 'QR_NOT_FOUND', expose: true,
  });
}

export async function requireActiveQrCollaborator(db, id) {
  const collaborator = await db.collaborator.findUnique({
    where: { id }, select: { id: true, name: true, shortName: true, status: true },
  });
  if (!collaborator || collaborator.status !== 'active') throw qrPageNotFound();
  return collaborator;
}
