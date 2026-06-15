// Free-port resolver for the client's always-on server (SOW-006). A self-contained copy of the project
// port-fallback convention (mirrors scripts/free-port.mjs) so the published npm package depends on nothing
// outside client/. This machine runs many local node servers, so the server must bind a preferred port and
// fall back to the next free one.

import net from 'node:net';

export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(preferred = 4500, attempts = 50) {
  const start = Number(preferred) || 4500;
  for (let p = start; p < start + attempts && p <= 65535; p++) {
    if (await isPortFree(p)) return p;
  }
  return 0; // 0 -> OS-assigned ephemeral port
}
