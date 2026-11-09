// Builds the web client into dist/client and the server into a single file, dist/server.cjs.
import { build as bundle } from 'esbuild';
import { build as buildClient } from 'vite';

// The same id goes into both halves; see shared/build.ts.
const define = { __BUILD_ID__: JSON.stringify(String(Date.now())) };

await buildClient({ define });

await bundle({
  define,
  entryPoints: ['server/src/index.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Native module: loaded from node_modules at run time.
  external: ['better-sqlite3'],
  logLevel: 'info',
});
