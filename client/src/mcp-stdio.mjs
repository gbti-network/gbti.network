#!/usr/bin/env node
// `gbti-network-mcp` (SOW-006): the stdio MCP server for spawn-style agent clients (Claude Code / Desktop).
// stdio is a trusted spawned child, so it is exempt from the HTTP server's localhost+token hardening. It
// speaks newline-delimited JSON-RPC and serves the same managed-abstraction tools as the HTTP transport
// (mcp-tools.dispatch), wired to the same context. Configure an agent to run: `npx gbti-network-mcp`.

import { createStore } from './store.mjs';
import { buildContext } from './context.mjs';
import { dispatch } from './mcp-tools.mjs';

const ctx = buildContext(createStore());

let buffer = '';
let chain = Promise.resolve(); // serialize message handling so responses never interleave

async function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON lines
  }
  const res = await dispatch(msg, ctx);
  if (res) process.stdout.write(JSON.stringify(res) + '\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) chain = chain.then(() => handleLine(line));
  }
});
process.stdin.on('end', () => {
  chain.then(() => process.exit(0));
});
