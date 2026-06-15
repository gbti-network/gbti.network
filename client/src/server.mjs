// The always-on local HTTP server (SOW-006). Binds 127.0.0.1 ONLY, resolves a free port with fallback
// (members run many local node servers, per the project port-fallback convention), and runs every request
// through the security gate (anti-rebinding Host check, anti-CSRF Origin check, per-install bearer token)
// BEFORE the application handler ever sees it. stdio MCP is a separate, trusted spawned child and does not
// use this server.

import http from 'node:http';
import { findFreePort } from './free-port.mjs';
import { requestAllowed } from './security.mjs';

const HOST = '127.0.0.1';

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(payload);
}

/**
 * Start the hardened server.
 * @param {object} a
 * @param {string} a.token             the per-install bearer token (required; without it nothing is authorized).
 * @param {number} [a.preferredPort]   preferred port; falls back to the next free one if taken.
 * @param {(req,res)=>void} a.handler   application handler, reached ONLY after the gate passes.
 * @returns {Promise<{server, port, host, url, close}>}
 */
export async function startServer({ token, preferredPort = 4500, handler }) {
  if (!token) throw new Error('startServer: a bearer token is required (refusing to run unauthenticated)');
  if (typeof handler !== 'function') throw new Error('startServer: handler is required');

  const port = await findFreePort(preferredPort);

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${HOST}`);
    } catch {
      return send(res, 400, { error: 'bad_request' });
    }
    const gate = requestAllowed({ headers: req.headers, token, queryToken: url.searchParams.get('token') });
    if (!gate.ok) {
      const status = gate.reason === 'unauthorized' ? 401 : 403;
      return send(res, status, { error: gate.reason });
    }
    // Strip the token from the URL before any handler sees it, so it cannot leak into query objects/logs.
    url.searchParams.delete('token');
    try {
      handler(req, res, url);
    } catch (err) {
      send(res, 500, { error: 'handler_failed' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });

  return {
    server,
    port,
    host: HOST,
    url: `http://${HOST}:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export { send };
