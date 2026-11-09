// Produces release/BacklogMatters-<version>.zip: the app, its own copy of Node, and
// double-click launchers. Nothing needs to be installed on the PC that runs it.
//
// The bundled Node is the same version as the Node running this script, because the
// SQLite driver in node_modules was built for exactly that version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('Packaging is supported on 64-bit Windows only.');
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const out = path.resolve('release/BacklogMatters');
const zip = path.resolve(`release/BacklogMatters-${version}.zip`);

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Downloads the official node.exe for this Node version and checks it against the published checksum. */
async function nodeExe() {
  const cached = path.resolve(`.cache/node-${process.version}-win-x64.exe`);
  if (fs.existsSync(cached)) return cached;
  const base = `https://nodejs.org/dist/${process.version}`;
  console.log(`Downloading Node ${process.version} from nodejs.org…`);
  const [exe, sums] = await Promise.all([download(`${base}/win-x64/node.exe`), download(`${base}/SHASUMS256.txt`)]);
  const expected = sums.toString().split('\n').find((line) => line.trim().endsWith(' win-x64/node.exe'))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(exe).digest('hex');
  if (!expected || expected !== actual) throw new Error('The downloaded node.exe does not match its published checksum.');
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, exe);
  return cached;
}

console.log('Building…');
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(path.join(out, 'runtime'), { recursive: true });

fs.cpSync('dist/server.cjs', path.join(out, 'app/server.cjs'));
fs.cpSync('dist/client', path.join(out, 'app/client'), { recursive: true });

// Only the run-time parts of the SQLite driver; the rest of node_modules is already inside server.cjs.
const modules = path.join(out, 'app/node_modules');
for (const file of ['package.json', 'lib', 'build/Release/better_sqlite3.node'])
  fs.cpSync(path.join('node_modules/better-sqlite3', file), path.join(modules, 'better-sqlite3', file), { recursive: true });
for (const name of ['bindings', 'file-uri-to-path'])
  fs.cpSync(path.join('node_modules', name), path.join(modules, name), { recursive: true });

fs.copyFileSync(await nodeExe(), path.join(out, 'runtime/node.exe'));
// Launchers and the README are text; cmd.exe and Notepad expect Windows line endings.
for (const file of fs.readdirSync('packaging'))
  fs.writeFileSync(path.join(out, file), fs.readFileSync(path.join('packaging', file), 'utf8').replace(/\r?\n/g, '\r\n'));

console.log('Checking that the packaged app starts…');
const check = execFileSync(path.join(out, 'runtime/node.exe'), ['-e', "const D=require('better-sqlite3');new D(':memory:').exec('select 1');console.log('ok')"], {
  cwd: path.join(out, 'app'),
  encoding: 'utf8',
});
if (check.trim() !== 'ok') throw new Error('The packaged SQLite driver failed to load.');

console.log('Creating zip…');
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
console.log(`Done: ${zip} (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
