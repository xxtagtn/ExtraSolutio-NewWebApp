import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const expectedFiles = [
  'manifest-v6.webmanifest',
  'manifest.webmanifest',
  'service-worker.js',
  'pwa-icons/icon-192-v6.png',
  'pwa-icons/icon-512-v6.png',
  'pwa-icons/icon-512-maskable-v6.png',
  'pwa-icons/apple-touch-icon-v6.png',
];

for (const relativePath of expectedFiles) {
  const filePath = path.join(dist, ...relativePath.split('/'));
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Asset PWA inválido: ${relativePath}`);
  }
}

const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest-v6.webmanifest'), 'utf8'));
const serviceWorker = await readFile(path.join(dist, 'service-worker.js'), 'utf8');

if (!indexHtml.includes('href="/manifest-v6.webmanifest"')) {
  throw new Error('O index.html não referencia o manifesto PWA v6.');
}

if (!indexHtml.includes('/pwa-icons/icon-192-v6.png')) {
  throw new Error('O favicon v6 não está referenciado no index.html.');
}

const purposes = new Map(manifest.icons.map((icon) => [icon.purpose, icon.src]));
if (purposes.get('any') !== '/pwa-icons/icon-512-v6.png') {
  throw new Error('O manifesto não tem o ícone normal de 512px esperado.');
}

if (purposes.get('maskable') !== '/pwa-icons/icon-512-maskable-v6.png') {
  throw new Error('O manifesto não tem um ícone maskable separado.');
}

if (!serviceWorker.includes("extrasolutio-pwa-v6")) {
  throw new Error('O service worker não utiliza a cache PWA v6.');
}

if (serviceWorker.includes("'/logo.png'")) {
  throw new Error('O service worker ainda inclui o logótipo antigo no app shell.');
}

console.log('PWA v6 verificada: manifesto, service worker e ícones estão completos no dist.');
