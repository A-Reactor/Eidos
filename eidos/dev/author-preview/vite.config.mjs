import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, '../..');
export default defineConfig({ root, resolve: { alias: { '@': path.join(project, 'src') }, dedupe: ['react', 'react-dom'] }, css: { postcss: project }, server: { host: '127.0.0.1', port: 4193, strictPort: true, fs: { allow: [project] } }, esbuild: { jsx: 'automatic' } });
