import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
execFileSync(process.execPath, [fileURLToPath(new URL('./build.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' });
const destination = path.join(root, 'build/sdk'); fs.mkdirSync(destination, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--cache', path.join(root, 'build/.sdk-npm-cache'), '--pack-destination', destination], { cwd: path.join(root, 'sdk'), encoding: 'utf8' }));
console.log(path.join(destination, packed[0].filename));
