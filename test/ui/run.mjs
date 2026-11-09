// Browser tests: drives the built app in Edge (or Chrome) against throwaway databases.
// Run with `npm run test:ui`. Screenshots of every step go to test-results/ui/.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { accounts } from './accounts.mjs';
import { findBrowser, runner, startServer } from './harness.mjs';
import { singleUser } from './single-user.mjs';

if (!fs.existsSync('dist/server.cjs')) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

const outDir = path.resolve('test-results/ui');
fs.rmSync(outDir, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: findBrowser(), headless: !process.env.BM_HEADED });
const results = [];

for (const [suite, flag, run] of [
  ['single-user', false, singleUser],
  ['accounts', true, accounts],
]) {
  const server = await startServer({ accounts: flag });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const { step, results: suiteResults } = runner(page, outDir, suite);
  try {
    await run({ page, base: server.base, step, outDir });
  } finally {
    results.push(...suiteResults);
    await context.close();
    server.stop();
  }
}
await browser.close();

const failed = results.filter((r) => r.failure);
console.log(`\n${results.length - failed.length} of ${results.length} steps passed. Screenshots: ${path.relative(process.cwd(), outDir)}`);
process.exit(failed.length ? 1 : 0);
