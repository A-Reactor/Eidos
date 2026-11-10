import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) {
  throw new Error('Run pack:open-source from a Git checkout of the repository root.');
}
if (git('status', '--porcelain')) throw new Error('Commit the release sources before building the archive.');

const destination = path.join(root, 'eidos/build/open-source');
const name = 'eidos-source.tar.gz';
mkdirSync(destination, { recursive: true });
const staging = mkdtempSync(path.join(destination, '.pack-'));
try {
  const archive = path.join(staging, name);
  const commit = git('rev-parse', 'HEAD');
  git('-c', 'tar.umask=0022', 'archive', '--format=tar.gz', '--prefix=eidos-source/', '-o', archive, commit);
  const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(`${archive}.sha256`, `${sha}  ${name}\n`);
  renameSync(archive, path.join(destination, name));
  renameSync(`${archive}.sha256`, path.join(destination, `${name}.sha256`));
  console.log(`Source archive: ${path.join(destination, name)}\nSHA-256: ${sha}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
