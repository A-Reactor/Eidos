import { execFile, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const game = fileURLToPath(new URL('./game/', import.meta.url));
const port = process.env.EIDOS_PLAYER_PORT || '3000';
if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid player port');
const url = `http://localhost:${port}`;
const data = process.env.EIDOS_PLAYER_DATA || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Eidos')
  : path.join(homedir(), 'Library', 'Application Support', 'Eidos'));
mkdirSync(data, { recursive: true });

const server = spawn(process.execPath, [path.join(game, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], {
  cwd: game,
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    EIDOS_MEDIA_DIR: path.join(data, 'generated'),
    MOMOI_TRAINING_DIR: path.join(data, 'voice-training'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
const exit = new Promise((resolve, reject) => {
  server.once('exit', resolve);
  server.once('error', reject);
});
// Preserve the terminal or Dock app as the lifetime owner of the server.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { closing = true; server.kill(); });
}
process.once('exit', () => server.kill());

let ready = false;
let tail = '';
server.stdout.setEncoding('utf8').on('data', chunk => {
  process.stdout.write(chunk);
  tail = (tail + chunk).slice(-1024);
  ready ||= tail.includes('Ready in');
});

async function waitForPage() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !closing && server.exitCode === null && server.signalCode === null) {
    // Only open the browser after this child has bound the port and serves the game.
    if (ready) {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
      await response?.body?.cancel();
      if (response?.ok) return;
    }
    await delay(200);
  }
  throw new Error(`Eidos 无法启动。请关闭已经运行的 Eidos 或占用 ${port} 端口的程序后重试。`);
}

async function openGame() {
  const run = promisify(execFile);
  if (process.platform === 'win32') {
    await run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true });
  } else {
    await run('/usr/bin/open', [url]);
  }
}

try {
  await Promise.race([waitForPage(), exit.then(() => { throw new Error(`Eidos 启动失败。请检查 ${port} 端口是否被占用。`); })]);
  console.log(`EIDOS_PLAYER_READY ${url}`);
  if (!process.argv.includes('--no-browser')) {
    await openGame().catch(error => console.error(`请在浏览器打开 ${url}。`, error.message));
  }
  const code = await exit;
  process.exitCode = closing ? 0 : code ?? 1;
} catch (error) {
  if (!closing) console.error(error.message);
  server.kill();
  process.exitCode = closing ? 0 : 1;
}
