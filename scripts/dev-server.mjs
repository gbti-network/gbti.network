#!/usr/bin/env node
// Launch the Astro dev/preview server on a free port, falling back automatically when the
// preferred port (PORT env or 4321) is already taken by another server on this machine.
//   node scripts/dev-server.mjs dev       # start dev on first free port from 4321
//   node scripts/dev-server.mjs preview   # same, for the production preview
//   node scripts/dev-server.mjs dev --print   # just print the resolved port (no server)
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFreePort } from './free-port.mjs';

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev';
const printOnly = process.argv.includes('--print');
const preferred = Number(process.env.PORT) || 4321;

const port = await findFreePort(preferred);

if (printOnly) {
  console.log(port);
  process.exit(0);
}
if (port !== preferred) {
  console.log(`\x1b[33m[gbti]\x1b[0m port ${preferred} is busy → serving on ${port || 'an OS-assigned port'} instead`);
}

// Print the access URL up front so it is unmissable (Astro/Vite also prints its own banner once ready;
// in the rare probe→bind race Astro may increment the port, and its banner is then the authoritative one).
if (port) {
  const url = `http://localhost:${port}/`;
  console.log(`\x1b[32m[gbti]\x1b[0m ${mode} server → \x1b[1m\x1b[36m${url}\x1b[0m   (Ctrl+C to stop)`);
}

// Make the local `astro` bin resolvable however this script was launched.
const binDir = fileURLToPath(new URL('../node_modules/.bin', import.meta.url));
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;

// Astro/Vite is also non-strict by default, so if the resolved port is grabbed in the race
// between probe and bind it still increments — belt and suspenders.
const child = spawn('astro', [mode, '--port', String(port)], { stdio: 'inherit', env: process.env });

// Forward termination to the child so stopping this wrapper never leaves an orphaned `astro`
// process holding the port (which causes port drift and stale dev views).
const stopChild = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('SIGTERM', () => { stopChild(); process.exit(0); });
process.on('SIGINT', () => { stopChild(); process.exit(0); });
process.on('exit', stopChild);

child.on('error', (err) => {
  console.error('[gbti] failed to start astro:', err);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
