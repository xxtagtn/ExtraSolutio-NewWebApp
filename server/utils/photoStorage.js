import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const UPLOADS_ROOT = fileURLToPath(new URL('../../public/uploads', import.meta.url));
const COLLABORATOR_DIR = path.join(UPLOADS_ROOT, 'collaborators');
const COLLABORATOR_THUMBS_DIR = path.join(COLLABORATOR_DIR, 'thumbs');

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

async function storeCollaboratorImage(value, targetDir, urlPrefix, filePrefix) {
  const parsed = parsePhotoDataUri(value);
  if (!parsed) return null;

  const buffer = Buffer.from(parsed.base64, 'base64');
  if (!buffer.length) return null;

  const digest = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const fileName = `${filePrefix}-${digest}.${parsed.extension}`;

  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, fileName), buffer);

  return `${urlPrefix}/${fileName}`;
}

export async function storeCollaboratorPhoto(value) {
  return storeCollaboratorImage(value, COLLABORATOR_DIR, '/uploads/collaborators', 'collab');
}

export async function storeCollaboratorPhotoThumb(value) {
  return storeCollaboratorImage(value, COLLABORATOR_THUMBS_DIR, '/uploads/collaborators/thumbs', 'collab-thumb');
}

function collaboratorUploadPath(value) {
  const raw = String(value || '');
  if (raw.startsWith('/uploads/collaborators/thumbs/')) {
    return path.join(COLLABORATOR_THUMBS_DIR, path.basename(raw));
  }
  if (raw.startsWith('/uploads/collaborators/')) {
    return path.join(COLLABORATOR_DIR, path.basename(raw));
  }
  return null;
}

export async function deleteStoredPhoto(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/uploads/collaborators/')) return;
  const targetPath = collaboratorUploadPath(raw);
  if (!targetPath) return;
  try {
    await unlink(targetPath);
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

export async function resolvePhotoThumbForStorage(inputPhotoThumb, existingPhotoThumb = null) {
  if (inputPhotoThumb === undefined) return undefined;
  if (!inputPhotoThumb) {
    if (existingPhotoThumb) await deleteStoredPhoto(existingPhotoThumb);
    return null;
  }

  const raw = String(inputPhotoThumb);
  if (raw.startsWith('data:')) {
    const url = await storeCollaboratorPhotoThumb(raw);
    if (!url) {
      const error = new Error('Formato de thumbnail não suportado. Usa JPG, PNG ou WEBP.');
      error.statusCode = 400;
      error.expose = true;
      throw error;
    }
    if (existingPhotoThumb && existingPhotoThumb !== url) await deleteStoredPhoto(existingPhotoThumb);
    return url;
  }

  return raw;
}
