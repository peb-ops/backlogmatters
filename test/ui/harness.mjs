// Shared pieces for the browser tests: starting a server, finding a browser, and running steps.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Edge ships with Windows, so it is the default. BM_BROWSER points at any other Chromium-based browser. */
export function findBrowser() {
  const candidates = [
    process.env.BM_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found. Set BM_BROWSER to the path of a Chromium-based browser.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** Starts the built server on a free port with an empty database in a temporary folder. */
export async function startServer({ accounts }) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-ui-'));
  const env = { ...process.env, BM_PORT: String(port), BM_DATA_DIR: dataDir, BM_HOST: '127.0.0.1' };
  delete env.BM_ACCOUNTS;
  delete env.BM_OPEN_BROWSER;
  if (accounts) env.BM_ACCOUNTS = '1';
  const child = spawn(process.execPath, ['dist/server.cjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw new Error(`Server exited early:\n${output}`);
    if (await fetch(base + '/api/auth/state').then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    stop() {
      child.kill();
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // Windows may still hold the database file for a moment; the folder is in the temp directory anyway.
      }
    },
  };
}

/**
 * Wraps a page so each step is reported, screenshots are kept, and unexpected errors fail the run.
 * Request errors (HTTP 400 and up) fail a step unless it is marked `{ expectErrors: true }`.
 */
export function runner(page, outDir, suite) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  let current = { errors: [] };
  let shots = 0;
  page.on('pageerror', (e) => current.errors.push({ kind: 'js', text: e.message }));
  page.on('response', (r) => r.status() >= 400 && current.errors.push({ kind: 'http', text: `HTTP ${r.status()} ${r.request().method()} ${r.url()}` }));
  page.on('console', (m) => {
    // The browser also logs every failed request; those are already counted above.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) current.errors.push({ kind: 'js', text: m.text() });
  });

  async function shot(name) {
    await page.waitForTimeout(250);
    const file = path.join(outDir, `${suite}-${String(++shots).padStart(2, '0')}-${name.replace(/\W+/g, '_').slice(0, 60)}.png`);
    await page.screenshot({ path: file, fullPage: true });
  }

  async function step(name, fn, { expectErrors = false } = {}) {
    current = { errors: [] };
    let failure = null;
    try {
      await fn();
    } catch (e) {
      failure = e.message.split('\n')[0];
    }
    const unexpected = current.errors.filter((e) => e.kind === 'js' || !expectErrors);
    if (!failure && unexpected.length) failure = unexpected.map((e) => e.text).join('; ');
    results.push({ suite, name, failure });
    console.log(`${failure ? 'FAIL' : 'ok  '} ${suite}: ${name}${failure ? `\n       ${failure}` : ''}`);
    await shot(failure ? `FAIL-${name}` : name).catch(() => {});
    if (failure) {
      // Close any dialog left open so the next step starts from a clean screen.
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  return { step, results };
}

/** Drags with the mouse in small moves, which is what the drag-and-drop library listens for. */
export async function drag(page, source, target) {
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('drag source or target is not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
