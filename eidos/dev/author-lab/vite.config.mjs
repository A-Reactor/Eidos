import { defineConfig } from 'vite';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModPackage } from '../../scripts/mod-package.mjs';
const root = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(root, '../..'), mods = path.join(project, 'mods');
export default defineConfig({ root, resolve: { alias: { '@': path.join(project, 'src') }, dedupe: ['react', 'react-dom'] }, css: { postcss: project }, esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 4197, strictPort: true, fs: { allow: [project] }, watch: { usePolling: true, interval: 500 } },
  plugins: [{ name: 'eidos-author-lab', configureServer(server) {
    server.watcher.add(mods);
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1'); if (!url.pathname.startsWith('/__lab/')) return next();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (req.method !== 'GET') throw new Error('只支持读取');
        if (url.pathname === '/__lab/sources') return res.end(JSON.stringify((await readdir(mods, { withFileTypes: true })).filter(d => d.isDirectory() && d.name !== 'dist').map(d => d.name)));
        const name = url.searchParams.get('name');
        if (url.pathname !== '/__lab/package' || !/^[a-z][a-z0-9_-]{0,63}$/.test(name ?? '')) throw new Error('模组目录无效');
        res.end(JSON.stringify(await loadModPackage(path.join(mods, name))));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
  }, handleHotUpdate(ctx) { if (ctx.file.startsWith(mods + path.sep)) {
    const name = path.relative(mods, ctx.file).split(path.sep)[0];
    if (name !== 'dist' && /^[a-z][a-z0-9_-]{0,63}$/.test(name)) ctx.server.ws.send({ type: 'custom', event: 'eidos-lab:changed', data: { name } });
    return [];
  } } }],
});
