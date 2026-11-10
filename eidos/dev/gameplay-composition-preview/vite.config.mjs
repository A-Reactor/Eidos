import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(root, '../..');
export default defineConfig({ root, resolve: { alias: { '@': path.join(project, 'src') }, dedupe: ['react', 'react-dom'] }, css: { postcss: project }, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 4195, strictPort: true, fs: { allow: [project] } } });
