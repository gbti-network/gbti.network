#!/usr/bin/env node
// `gbti-network` entry point (SOW-006): boots the long-running local node behind the HARDENED always-on
// server (127.0.0.1 + per-install token + Origin/Host gate, free-port fallback). It serves the CMS browser
// UI at `/` and the JSON API at `/api/*` (the same routes the HTTP MCP transport will mount on later).

import { createStore } from './store.mjs';
import { startServer, send } from './server.mjs';
import { generateToken } from './security.mjs';
import { handleApi } from './api.mjs';
import { dispatch as mcpDispatch } from './mcp-tools.mjs';
import { buildContext } from './context.mjs';
import { shellHtml } from './shell.mjs';

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy(); // cap request bodies
    });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
    // destroy() (oversized body) / abort emits 'close' without 'end'; resolve so the handler never hangs.
    req.on('close', () => resolve(undefined));
  });
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function main() {
  const store = createStore();
  const token = store.ensureEndpointToken(() => generateToken());
  const preferredPort = store.get('preferredPort') ?? 4500;

  const { url, port, close } = await startServer({
    token,
    preferredPort,
    handler: async (req, res, parsedUrl) => {
      try {
        const pathname = parsedUrl.pathname;
        const method = req.method.toUpperCase();

        if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          return sendHtml(res, shellHtml());
        }
        if (pathname.startsWith('/api/')) {
          const body = method === 'POST' ? await readJson(req) : undefined;
          const result = await handleApi(
            { method, pathname, query: parsedUrl.searchParams, body },
            buildContext(store),
          );
          return send(res, result.status, result.json);
        }
        // HTTP MCP transport: the same managed-abstraction tools as stdio, behind the hardened gate.
        if (method === 'POST' && pathname === '/mcp') {
          if (store.get('mcpEnabled') === false) return send(res, 403, { error: 'mcp_disabled' });
          const message = await readJson(req);
          const response = await mcpDispatch(message ?? {}, buildContext(store));
          return send(res, 200, response ?? { ok: true }); // null = a notification (no response body)
        }
        return send(res, 404, { error: 'not_found', message: 'Unknown action. Restart the GBTI client (npm run gbti-network) to pick up the latest routes.' });
      } catch (err) {
        send(res, 500, { error: 'internal_error', message: err?.message });
      }
    },
  });

  console.log(`gbti-network local node running (preferred ${preferredPort}, bound ${port})`);
  console.log(`Open the CMS:  ${url}/?token=${token}`);
  console.log(`Endpoint token (for agents/MCP):  ${token}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('gbti-network failed to start:', err?.message ?? err);
  process.exit(1);
});
