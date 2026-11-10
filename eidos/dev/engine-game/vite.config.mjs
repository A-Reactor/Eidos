import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const project = path.resolve(root, '../..');
export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(project, 'src') } },
  css: { postcss: project },
  server: { host: '127.0.0.1', port: 3031, strictPort: true, fs: { allow: [project] } },
  build: { outDir: path.join(project, 'build/engine-game') },
});
