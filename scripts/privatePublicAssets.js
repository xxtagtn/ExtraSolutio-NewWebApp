import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function publicAssetFiles(root, prefix = '') {
  const assets = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (!prefix && entry.name.toLowerCase() === 'uploads') continue;
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) assets.push(...await publicAssetFiles(root, name));
    else if (entry.isFile()) assets.push({ fileName: name, source: await readFile(path.join(root, name)) });
  }
  return assets;
}

export function privatePublicAssets() {
  let publicDir;
  return {
    name: 'exclude-private-uploads',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
        catch { res.statusCode = 400; res.end(); return; }
        if (/^\/uploads(?:\/|$)/i.test(pathname) || /\/public\/uploads(?:\/|$)/i.test(pathname.replaceAll('\\', '/'))) {
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    },
    async generateBundle() {
      for (const asset of await publicAssetFiles(publicDir)) this.emitFile({ type: 'asset', ...asset });
    },
  };
}
