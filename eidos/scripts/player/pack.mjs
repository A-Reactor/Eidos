import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smoke } from './smoke.mjs';

const mac = process.platform === 'darwin' && process.arch === 'arm64';
const windows = process.platform === 'win32' && process.arch === 'x64';
if (!mac && !windows) throw new Error('Build the player on Apple Silicon macOS or x64 Windows.');
const nodeVersion = 'v24.22.2';
const runtime = `node-${nodeVersion}-${mac ? 'darwin-arm64' : 'win-x64'}`;
const nodeArchive = `${runtime}.${mac ? 'tar.xz' : 'zip'}`;
const nodeSHA = mac ? '1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115'
  : 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2';
const binary = mac ? 'node' : 'node.exe';
const eidos = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(eidos, 'build', 'player');
const name = `Eidos-${mac ? 'macOS-arm64' : 'Windows-x64'}.zip`;
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (file, args, options = {}) => execFileSync(file, args, { stdio: 'inherit', ...options });
const copy = (source, target, options = {}) => cpSync(source, target, { recursive: true, verbatimSymlinks: true, ...options });

function prepareSource(staging) {
  run(process.execPath, [path.join(eidos, 'scripts/pack-open-source.mjs')]);
  run('tar', ['-xf', path.join(eidos, 'build/open-source/eidos-source.tar.gz'), '-C', staging]);
  const source = path.join(staging, 'eidos-source', 'eidos');
  const options = { cwd: source, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } };
  const npm = (...args) => run(process.execPath, [process.env.npm_execpath, ...args], options);
  npm('ci', '--prefer-offline', '--no-audit', '--no-fund');
  npm('run', 'build');
  npm('ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund');
  return source;
}

function copyGame(source, resources) {
  const game = path.join(resources, 'game');
  mkdirSync(game, { recursive: true });
  const build = path.join(source, '.next');
  const skip = new Set(['cache', 'diagnostics', 'types', 'trace', 'trace-build', 'turbopack']);
  copy(build, path.join(game, '.next'), { filter: file => !skip.has(path.relative(build, file).split(path.sep)[0]) });
  for (const file of ['public', 'package.json', 'next.config.ts', 'node_modules']) {
    copy(path.join(source, file), path.join(game, file));
  }
  mkdirSync(path.join(game, 'scripts'));
  for (const file of ['voice-server-gpt-sovits.py', 'voice-training-worker.py', 'voice-installation-check.py']) {
    copy(path.join(source, 'scripts', file), path.join(game, 'scripts', file));
  }
  copy(path.join(source, '..', 'LICENSE'), path.join(resources, 'LICENSE-Eidos.txt'));
  copy(path.join(source, 'scripts/player/start.mjs'), path.join(resources, 'start.mjs'));
}

function copyNode(staging, resources) {
  const input = process.env.EIDOS_PLAYER_NODE_ARCHIVE || path.join(staging, nodeArchive);
  if (!process.env.EIDOS_PLAYER_NODE_ARCHIVE) {
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '180',
      '-o', input, `https://nodejs.org/dist/${nodeVersion}/${nodeArchive}`]);
  }
  if (hash(input) !== nodeSHA) throw new Error(`Node.js checksum mismatch for ${nodeArchive}.`);
  run('tar', ['-xf', input, '-C', staging]);
  const target = path.join(resources, 'runtime');
  mkdirSync(target);
  copy(path.join(staging, runtime, mac ? 'bin/node' : binary), path.join(target, binary));
  copy(path.join(staging, runtime, 'LICENSE'), path.join(target, 'LICENSE.txt'));
}

function buildMacLauncher(staging, source, bundle) {
  const contents = path.join(bundle, 'Contents');
  const launcher = path.join(contents, 'MacOS', 'Eidos');
  mkdirSync(path.dirname(launcher), { recursive: true });
  run('swiftc', ['-target', 'arm64-apple-macos13.5', '-module-cache-path', path.join(staging, 'swift-cache'),
    '-O', path.join(source, 'scripts/player/Launcher.swift'), '-o', launcher]);
  copy(path.join(source, 'src-tauri/icons/icon.icns'), path.join(contents, 'Resources/icon.icns'));
  const version = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')).version;
  writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Eidos</string>
  <key>CFBundleIdentifier</key><string>com.eidos.player</string>
  <key>CFBundleName</key><string>Eidos</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.5</string>
</dict></plist>\n`);
  run('codesign', ['--force', '--sign', '-', bundle]);
}

mkdirSync(destination, { recursive: true });
const staging = mkdtempSync(path.join(tmpdir(), 'eidos-player-'));
const output = mkdtempSync(path.join(destination, '.pack-'));
try {
  const source = prepareSource(staging);
  const bundle = path.join(staging, mac ? 'Eidos.app' : 'Eidos');
  const resources = mac ? path.join(bundle, 'Contents', 'Resources') : bundle;
  copyGame(source, resources);
  copyNode(staging, resources);
  if (mac) buildMacLauncher(staging, source, bundle);
  else copy(path.join(source, 'scripts/player/Start Eidos.cmd'), path.join(bundle, 'Start Eidos.cmd'));

  const archive = path.join(output, name);
  if (mac) run('ditto', ['-c', '-k', '--norsrc', '--keepParent', bundle, archive]);
  else run('tar', ['-a', '-cf', archive, '-C', staging, 'Eidos']);
  const extracted = path.join(staging, 'Fresh player copy');
  const smokeData = path.join(staging, 'Smoke data');
  mkdirSync(extracted);
  mkdirSync(smokeData);
  run('tar', ['-xf', archive, '-C', extracted]);
  if (mac) run('codesign', ['--verify', path.join(extracted, 'Eidos.app')]);
  await smoke(path.join(extracted, path.relative(staging, resources)), binary, smokeData);

  writeFileSync(`${archive}.sha256`, `${hash(archive)}  ${name}\n`);
  renameSync(archive, path.join(destination, name));
  renameSync(`${archive}.sha256`, path.join(destination, `${name}.sha256`));
  console.log(`Player archive: ${path.join(destination, name)}`);
} finally {
  rmSync(output, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
}
