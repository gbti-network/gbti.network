#!/usr/bin/env node
// SOW-088: the Reddit OAuth helper (the recovered Radle refresh token was revoked, so fresh mints happen
// here). Mirrors scripts/linkedin-auth.mjs: LOCAL-ONLY, tokens print to the terminal, nothing stored.
//
//   node scripts/reddit-auth.mjs
//     The authorization-code flow with duration=permanent: prints the authorize URL, you approve as the
//     brand Reddit account, the localhost callback captures the code, and it prints the PERMANENT refresh
//     token (put it in .env as REDDIT_REFRESH_TOKEN) + the secret-set commands.
//
// PREREQ: the Reddit app (reddit.com/prefs/apps, a WEB app) must list the redirect uri
// http://localhost:8976/callback — the old Radle install pointed it at the dead WordPress REST route.
// Credentials come from the repo-root .env (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET) or prompts.
// Scopes: identity submit read (submit posts; identity/read for probing).

import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: prompts cover it */ }

const PORT = 8976;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'identity submit read';
const USER_AGENT = 'cloudflare-worker:network.gbti.syndication:v0.1 (by /u/gbti_network)';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

const clientId = process.env.REDDIT_CLIENT_ID || (await ask('Reddit Client ID: '));
const clientSecret = process.env.REDDIT_CLIENT_SECRET || (await ask('Reddit Client Secret: '));
if (!clientId || !clientSecret) { console.error('Both the client id and the client secret are required.'); process.exit(1); }

const state = Math.random().toString(36).slice(2);
const authorizeUrl = 'https://www.reddit.com/api/v1/authorize?' + new URLSearchParams({
  client_id: clientId, response_type: 'code', state, redirect_uri: REDIRECT, duration: 'permanent', scope: SCOPES,
}).toString();

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
    const err = url.searchParams.get('error');
    if (err) { res.writeHead(200); res.end(`Reddit returned: ${err}`); server.close(); reject(new Error(err)); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('state mismatch'); server.close(); reject(new Error('state mismatch')); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h3>Got it. Return to the terminal.</h3>');
    server.close();
    resolve(url.searchParams.get('code'));
  });
  server.on('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is busy; free it and re-run (the redirect must match exactly).`) : e));
  server.listen(PORT, () => {
    console.log('\n1. Open this URL in the browser signed in as the BRAND Reddit account (the subreddit owner):\n');
    console.log(authorizeUrl);
    console.log('\n2. Click Allow. The callback lands here automatically...\n');
  });
}).catch((e) => { console.error(e.message); process.exit(1); });

const res = await fetch('https://www.reddit.com/api/v1/access_token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }).toString(),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.refresh_token) {
  console.error(`Token exchange failed (${res.status}):`, JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
console.log('\n=== TOKENS ===');
console.log(`REFRESH TOKEN (PERMANENT — update REDDIT_REFRESH_TOKEN in .env):\n${body.refresh_token}\n`);
console.log(`Access token (~${Math.floor((body.expires_in || 0) / 60)} min, informational): ${String(body.access_token).slice(0, 12)}...`);
console.log(`Granted scopes: ${body.scope}`);
console.log('\n=== Then push the secrets ===');
console.log('set -a; source .env; set +a; echo "$REDDIT_REFRESH_TOKEN" | npx wrangler secret put REDDIT_REFRESH_TOKEN --env production --cwd workers/signup');
