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
  server: { host: '127.0.0.1', port: 3034, strictPort: true, watch: { usePolling: true }, fs: { allow: [project] } },
});
