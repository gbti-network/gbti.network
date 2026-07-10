#!/usr/bin/env node
// SOW-088: the LinkedIn OAuth helper. Two modes, both LOCAL-ONLY (tokens print to your terminal; nothing
// is stored or committed):
//
//   node scripts/linkedin-auth.mjs
//     The one-time authorization-code flow. Starts a localhost callback server, prints the authorize URL,
//     you approve as a GBTI page admin, and it exchanges the code and prints the access token (~60 days),
//     the refresh token (~365 days), and the exact secret-set commands.
//
//   node scripts/linkedin-auth.mjs --refresh
//     The ~60-day renewal. Exchanges the refresh token for a fresh access token (no browser needed).
//
// Credentials come from env or interactive prompts: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (and
// LINKEDIN_REFRESH_TOKEN for --refresh). The redirect URL http://localhost:8976/callback must be listed
// under the app's Authorized redirect URLs (the Auth tab). The port is FIXED because OAuth requires an
// exact redirect match, so this is a deliberate exception to the port-fallback rule: if 8976 is busy,
// free it and re-run.
//
// Scopes: w_organization_social (post as the org) + r_organization_social (the credential-health org read).

import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The owner's credential store is the gitignored repo-root .env: load it so the flow needs no prompts.
// Only fills variables that are not already set; simple KEY=VALUE lines, # comments ignored.
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: the prompts below cover it */ }

const PORT = 8976;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'w_organization_social r_organization_social';

function ask(question, { secret = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (secret && rl.output) {
      // Mask the secret as it is typed.
      const onData = () => {};
      rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); });
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
      void onData;
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    }
  });
}

async function creds() {
  const clientId = process.env.LINKEDIN_CLIENT_ID || (await ask('LinkedIn Client ID: '));
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || (await ask('LinkedIn Client Secret: ', { secret: true }));
  if (!clientId || !clientSecret) { console.error('Both the client id and the client secret are required.'); process.exit(1); }
  return { clientId, clientSecret };
}

async function exchange(params) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.error(`Token exchange failed (${res.status}):`, JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }
  return body;
}

function printTokens(body) {
  const days = (s) => (s ? Math.floor(s / 86400) : '?');
  console.log('\n=== TOKENS (store these in your password manager NOW) ===');
  console.log(`ACCESS TOKEN  (expires in ~${days(body.expires_in)} days):\n${body.access_token}\n`);
  if (body.refresh_token) {
    console.log(`REFRESH TOKEN (expires in ~${days(body.refresh_token_expires_in)} days):\n${body.refresh_token}\n`);
  } else {
    console.log('No refresh token returned (some app tiers omit it); renewal = re-run this flow.\n');
  }
  console.log('=== Set the secrets ===');
  console.log('cd workers/signup && npx wrangler secret put LINKEDIN_ACCESS_TOKEN --env production');
  console.log('gh secret set LINKEDIN_ACCESS_TOKEN');
  console.log('(paste the access token at each prompt; LINKEDIN_ORG_URN should already be set)');
}

async function refreshFlow() {
  const { clientId, clientSecret } = await creds();
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN || (await ask('Refresh token: ', { secret: true }));
  const body = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  printTokens(body);
}

async function authorizeFlow() {
  const { clientId, clientSecret } = await creds();
  const state = Math.random().toString(36).slice(2);
  const authorizeUrl = 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state, scope: SCOPES,
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h3>LinkedIn returned: ${err}</h3><p>${url.searchParams.get('error_description') || ''}</p>`);
        server.close(); reject(new Error(`${err}: ${url.searchParams.get('error_description') || ''}`)); return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400); res.end('state mismatch'); server.close(); reject(new Error('state mismatch')); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h3>Got it. Return to the terminal.</h3>');
      server.close();
      resolve(url.searchParams.get('code'));
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') reject(new Error(`Port ${PORT} is busy. The OAuth redirect must match exactly, so free the port and re-run.`));
      else reject(e);
    });
    server.listen(PORT, () => {
      console.log('\n1. Open this URL in the browser where you are signed in as a GBTI page admin:\n');
      console.log(authorizeUrl);
      console.log('\n2. Approve. The callback lands here automatically...\n');
    });
  }).catch((e) => { console.error(e.message); process.exit(1); });

  const body = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, client_secret: clientSecret });
  printTokens(body);
}

if (process.argv.includes('--refresh')) await refreshFlow();
else await authorizeFlow();
