// Build the agent-owned Rive file and commit-ready artifacts.
//   node scripts/rive-build.js
// Needs the Rive CLI (~/.rive/bin/rive). CI never runs this: it checks the committed
// .riv against the source hash in test/riveContract.test.js instead.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
const project = join(root, 'rive/fantasy');
const rive = process.env.RIVE_BIN ?? join(homedir(), '.rive/bin/rive');

export function sourceHash() {
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'build' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(rml|yaml|ttf|png|webp)$/.test(name)) files.push(path);
    }
  };
  walk(project);
  const hash = createHash('sha256');
  for (const f of files) hash.update(f.slice(project.length)).update(readFileSync(f));
  return hash.digest('hex');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  execFileSync(rive, ['.', '--once'], { cwd: project, stdio: 'inherit' });
  mkdirSync(join(root, 'src/rive/bin'), { recursive: true });
  copyFileSync(join(project, 'build/fantasy.riv'), join(root, 'src/rive/bin/fantasy.riv'));
  writeFileSync(join(root, 'src/rive/bin/fantasy.meta.json'), JSON.stringify({ srcHash: sourceHash(), mode: 'once' }, null, 2) + '\n');
  console.log('built src/rive/bin/fantasy.riv');
}
