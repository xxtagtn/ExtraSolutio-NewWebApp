import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const UPLOADS_ROOT = fileURLToPath(new URL('../../public/uploads', import.meta.url));
const COLLABORATOR_DIR = path.join(UPLOADS_ROOT, 'collaborators');

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export function parsePhotoDataUri(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const extension = EXTENSIONS[mime];
  if (!extension) return null;
  return { mime, extension, base64: match[2].replace(/\s/g, '') };
}

export async function storeCollaboratorPhoto(value) {
  const parsed = parsePhotoDataUri(value);
  if (!parsed) return null;

  const buffer = Buffer.from(parsed.base64, 'base64');
  if (!buffer.length) return null;

  const digest = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const fileName = `collab-${digest}.${parsed.extension}`;

  await mkdir(COLLABORATOR_DIR, { recursive: true });
  await writeFile(path.join(COLLABORATOR_DIR, fileName), buffer);

  return `/uploads/collaborators/${fileName}`;
}

export async function deleteStoredPhoto(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/uploads/collaborators/')) return;
  const fileName = path.basename(raw);
  try {
    await unlink(path.join(COLLABORATOR_DIR, fileName));
  } catch {
    // Se o ficheiro já não existe, não há nada a remover.
  }
}

export async function resolvePhotoForStorage(inputPhoto, existingPhoto = null) {
  if (inputPhoto === undefined) return undefined;
  if (!inputPhoto) {
    if (existingPhoto) await deleteStoredPhoto(existingPhoto);
    return null;
  }

  const raw = String(inputPhoto);
  if (raw.startsWith('data:')) {
    const url = await storeCollaboratorPhoto(raw);
    if (!url) {
      const error = new Error('Formato de imagem não suportado. Usa JPG, PNG ou WEBP.');
      error.statusCode = 400;
      error.expose = true;
      throw error;
    }
    if (existingPhoto && existingPhoto !== url) await deleteStoredPhoto(existingPhoto);
    return url;
  }

  return raw;
}
