// Runs the API server (restarting on change) and the Vite dev server together.
// Open http://localhost:5173 while developing.
import { spawn } from 'node:child_process';

const children = ['tsx watch server/src/index.ts', 'vite'].map((command) =>
  spawn(`npx ${command}`, { stdio: 'inherit', shell: true }),
);

for (const child of children) {
  child.on('exit', (code) => {
    for (const other of children) other.kill();
    process.exit(code ?? 0);
  });
}
