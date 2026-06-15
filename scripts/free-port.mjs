import net from 'node:net';

/** Resolve whether a TCP port is free on 127.0.0.1. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Find a free port starting at `preferred`, scanning upward. Returns 0 (→ an OS-assigned
 * ephemeral port) if none are free in the scanned range.
 *
 * This machine runs many node servers, so every local server in this project must resolve a free
 * port rather than failing on a busy one. Shared by the Astro dev/preview launcher and (later) the
 * SOW-006 local client and SOW-002 signup worker.
 */
export async function findFreePort(preferred = 4321, attempts = 50) {
  const start = Number(preferred) || 4321;
  for (let p = start; p < start + attempts && p <= 65535; p++) {
    if (await isPortFree(p)) return p;
  }
  return 0;
}
