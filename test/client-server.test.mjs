// SOW-006 hardened server: integration tests. Starts a real server on a free loopback port and verifies
// the gate end to end (token required, bad Host / bad Origin rejected). Confirms the HARD REQUIREMENT that
// the always-on server never serves an unauthenticated or rebinding/CSRF request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startServer, send } from '../client/src/server.mjs';

function request(port, { headers = {}, pathname = '/status' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const TOKEN = 'test-token-abc';
const handler = (req, res) => send(res, 200, { ok: true });

test('startServer: refuses to run without a token', async () => {
  await assert.rejects(startServer({ token: '', handler }), /token is required/);
});

test('hardened server: authorized request passes; unauthorized is 401', async () => {
  const srv = await startServer({ token: TOKEN, preferredPort: 4600, handler });
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const ok = await request(srv.port, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).ok, true);

    const noTok = await request(srv.port, {});
    assert.equal(noTok.status, 401);
    assert.equal(JSON.parse(noTok.body).error, 'unauthorized');

    const badTok = await request(srv.port, { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(badTok.status, 401);
  } finally {
    await srv.close();
  }
});

test('hardened server: bad Host (rebinding) and bad Origin (CSRF) are 403 before auth', async () => {
  const srv = await startServer({ token: TOKEN, preferredPort: 4700, handler });
  try {
    const badHost = await request(srv.port, { headers: { Host: 'evil.com', Authorization: `Bearer ${TOKEN}` } });
    assert.equal(badHost.status, 403);
    assert.equal(JSON.parse(badHost.body).error, 'bad-host');

    const badOrigin = await request(srv.port, { headers: { Origin: 'https://evil.com', Authorization: `Bearer ${TOKEN}` } });
    assert.equal(badOrigin.status, 403);
    assert.equal(JSON.parse(badOrigin.body).error, 'bad-origin');
  } finally {
    await srv.close();
  }
});
