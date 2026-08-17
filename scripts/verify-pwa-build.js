import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const expectedFiles = [
  'manifest-v5.webmanifest',
  'manifest.webmanifest',
  'service-worker.js',
  'icons/icon-192-v5.png',
  'icons/icon-512-v5.png',
  'icons/icon-512-maskable-v5.png',
  'icons/apple-touch-icon-v5.png',
];

for (const relativePath of expectedFiles) {
  const filePath = path.join(dist, ...relativePath.split('/'));
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Asset PWA inválido: ${relativePath}`);
  }
}

const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest-v5.webmanifest'), 'utf8'));
const serviceWorker = await readFile(path.join(dist, 'service-worker.js'), 'utf8');

if (!indexHtml.includes('href="/manifest-v5.webmanifest"')) {
  throw new Error('O index.html não referencia o manifesto PWA v5.');
}

if (!indexHtml.includes('/icons/icon-192-v5.png')) {
  throw new Error('O favicon v5 não está referenciado no index.html.');
}

const purposes = new Map(manifest.icons.map((icon) => [icon.purpose, icon.src]));
if (purposes.get('any') !== '/icons/icon-512-v5.png') {
  throw new Error('O manifesto não tem o ícone normal de 512px esperado.');
}

if (purposes.get('maskable') !== '/icons/icon-512-maskable-v5.png') {
  throw new Error('O manifesto não tem um ícone maskable separado.');
}

if (!serviceWorker.includes("extrasolutio-pwa-v5")) {
  throw new Error('O service worker não utiliza a cache PWA v5.');
}

if (serviceWorker.includes("'/logo.png'")) {
  throw new Error('O service worker ainda inclui o logótipo antigo no app shell.');
}

console.log('PWA v5 verificada: manifesto, service worker e ícones estão completos no dist.');
