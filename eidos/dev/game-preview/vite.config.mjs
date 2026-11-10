import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const project = path.resolve(root, '../..');
export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(project, 'src') }, dedupe: ['react', 'react-dom'] },
  esbuild: { jsx: 'automatic' },
  css: { postcss: project },
  server: { host: '127.0.0.1', port: 3020, strictPort: true,
    proxy: { '/api/momoi': { target: 'http://localhost:3000', changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (outgoing, incoming) => {
          // Preserve the API's origin protection; translate only our own preview origin.
          if (incoming.headers.origin === 'http://127.0.0.1:3020') outgoing.setHeader('origin', 'http://localhost:3000');
        });
      },
    } }, watch: { usePolling: true, interval: 500 }, fs: { allow: [project] } },
});
