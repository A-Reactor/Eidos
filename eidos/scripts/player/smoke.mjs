import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function smoke(resources, binary, data) {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));

  const app = spawn(path.join(resources, 'runtime', binary), [path.join(resources, 'start.mjs'), '--no-browser'], {
    cwd: data,
    env: { ...process.env, PATH: '', EIDOS_PLAYER_PORT: String(port), EIDOS_PLAYER_DATA: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(app, 'exit');
  let log = '';
  for (const stream of [app.stdout, app.stderr]) stream.setEncoding('utf8').on('data', chunk => { log += chunk; });
  try {
    for (let attempt = 0; !log.includes('EIDOS_PLAYER_READY'); attempt++) {
      assert(app.exitCode === null && app.signalCode === null && attempt < 180, log);
      await delay(200);
    }
    const url = `http://127.0.0.1:${port}`;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    const asset = html.match(/href="(\/_next\/static\/[^"?]+\.css)/u)?.[1];
    assert(asset, 'the game page references its compiled CSS');
    assert.equal((await fetch(url + asset)).status, 200);

    const form = new FormData();
    for (const [key, value] of Object.entries({ worldId: '新世界', targetType: 'world', targetId: 'cover', slot: 'cover' })) {
      form.set(key, value);
    }
    form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/SkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'cover.png');
    const upload = await fetch(url + '/api/midori/upload-image', { method: 'POST', body: form });
    assert.equal(upload.status, 200, await upload.clone().text());
    const { imageUrl } = await upload.json();
    assert.equal((await fetch(url + imageUrl)).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(url + imageUrl, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    console.log('Player archive smoke passed with the bundled Node.js, compiled UI, and live media.');
  } catch (error) {
    throw new Error(`Player smoke failed.\n${log}`, { cause: error });
  } finally {
    // A Windows TerminateProcess does not run the parent JS signal handler. Kill only its process tree.
    if (process.platform === 'win32' && app.exitCode === null) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F']);
    else app.kill();
    await exit;
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
  }
}
