// sow-283 / sow-272: the SSRF controls for fetching member-supplied URLs from CI. No network: `request` and the DNS
// `resolve` are injected. The fake request calls the `lookup` it was handed exactly as a socket would, so a test
// that passes proves the guarded lookup is WIRED to the connection, not merely that it exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { isBlockedAddress, checkTarget, guardedLookup, safeGet } from '../scripts/lib/safe-fetch.mjs';

const PUBLIC_IP = '93.184.215.14';

/**
 * A fake https.request. `routes` maps a URL href to { status, headers, body } or { hang: true }. Before answering it
 * resolves the hostname through the lookup it was given, like net.connect does, and fails with that error.
 */
function fakeRequest(routes, seen = []) {
  return (url, opts, onResponse) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      seen.push(url.href);
      opts.lookup(url.hostname, {}, (err) => {
        if (err) return req.emit('error', err);
        const r = routes[url.href];
        if (!r) return req.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
        if (r.hang) return;
        const res = new EventEmitter();
        res.statusCode = r.status;
        res.headers = r.headers || {};
        res.resume = () => {};
        res.destroy = () => { res.destroyed = true; };
        onResponse(res);
        setImmediate(() => {
          for (const chunk of r.chunks || (r.body ? [Buffer.from(r.body)] : [])) {
            if (res.destroyed) return;
            res.emit('data', Buffer.from(chunk));
          }
          if (!res.destroyed) res.emit('end');
        });
      });
    };
    return req;
  };
}
const resolveTo = (map) => (host, _opts, cb) => {
  const ip = map[host];
  if (!ip) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  cb(null, (Array.isArray(ip) ? ip : [ip]).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
};

test('isBlockedAddress refuses every private, loopback, link-local, metadata, mapped and reserved range', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1',
    '64:ff9b::1.2.3.4', '2002:0a00:0001::', '2001::1', '2001:db8::1', '100::1', 'not-an-ip', '']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
  for (const ip of [PUBLIC_IP, '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} is public`);
  }
});

test('checkTarget: https on the default port only, no credentials, no internal names, IP literals checked', () => {
  const reason = (u) => checkTarget(u).reason;
  assert.equal(reason('http://example.com/a.jpg'), 'not-https');
  assert.equal(reason('ftp://example.com/'), 'not-https');
  assert.equal(reason('https://u:p@example.com/'), 'credentials');
  assert.equal(reason('https://example.com:8443/'), 'port');
  assert.equal(reason('https://localhost/'), 'blocked-host');
  assert.equal(reason('https://metadata.google.internal/'), 'blocked-host');
  assert.equal(reason('https://printer.local/'), 'blocked-host');
  assert.equal(reason('https://intranet/'), 'blocked-host');
  assert.equal(reason('https://127.0.0.1/'), 'blocked-address');
  assert.equal(reason('https://2130706433/'), 'blocked-address', 'an integer host normalizes to 127.0.0.1');
  assert.equal(reason('https://[::1]/'), 'blocked-address');
  assert.equal(reason('https://[::ffff:169.254.169.254]/'), 'blocked-address');
  assert.equal(reason('not a url'), 'bad-url');
  // The old Worker guard refused any host starting "fc" or "fd"; this one must not.
  assert.equal(checkTarget('https://fdroid.org/x').ok, true);
  assert.equal(checkTarget('https://fcc.gov/').ok, true);
  assert.equal(checkTarget('https://cdn.sanity.io/i.png?w=1&amp;h=2').url.search, '?w=1&h=2', 'a stored &amp; is decoded');
});

test('guardedLookup refuses a name when ANY of its addresses is private (a public + private pair included)', async () => {
  const run = (addrs, opts = {}) => new Promise((resolve) => {
    guardedLookup(resolveTo({ 'x.test': addrs }))('x.test', opts, (err, a, f) => resolve({ err, a, f }));
  });
  assert.equal((await run('10.0.0.5')).err.code, 'EBLOCKED');
  assert.equal((await run([PUBLIC_IP, '127.0.0.1'])).err.code, 'EBLOCKED');
  assert.equal((await run(['::ffff:127.0.0.1'])).err.code, 'EBLOCKED');
  const ok = await run(PUBLIC_IP);
  assert.equal(ok.err, null);
  assert.equal(ok.a, PUBLIC_IP);
  const all = await run([PUBLIC_IP], { all: true });
  assert.deepEqual(all.a, [{ address: PUBLIC_IP, family: 4 }], 'the all:true form a socket may ask for');
});

test('safeGet: a public name that RESOLVES to a private address is refused before any response', async () => {
  const r = await safeGet('https://rebind.test/a.jpg', {
    maxBytes: 1000, request: fakeRequest({ 'https://rebind.test/a.jpg': { status: 200, body: 'secret' } }), resolve: resolveTo({ 'rebind.test': '169.254.169.254' }),
  });
  assert.deepEqual(r, { ok: false, reason: 'blocked-address' });
});

test('safeGet: the REAL https.request consults the guarded lookup (the wiring, with no network)', async () => {
  const r = await safeGet('https://rebind.test/a.jpg', { maxBytes: 1000, request: https.request, resolve: resolveTo({ 'rebind.test': '127.0.0.1' }), timeoutMs: 3000 });
  assert.deepEqual(r, { ok: false, reason: 'blocked-address' });
});

test('safeGet: every redirect hop is re-checked, by scheme, by IP literal and by resolved address', async () => {
  const resolve = resolveTo({ 'good.test': PUBLIC_IP, 'evil.test': '10.1.1.1' });
  const hop = (location) => fakeRequest({ 'https://good.test/start': { status: 302, headers: { location } } });
  assert.equal((await safeGet('https://good.test/start', { maxBytes: 10, request: hop('https://169.254.169.254/latest/meta-data/'), resolve })).reason, 'blocked-address');
  assert.equal((await safeGet('https://good.test/start', { maxBytes: 10, request: hop('http://good.test/insecure'), resolve })).reason, 'not-https');
  const seen = [];
  const req = fakeRequest({ 'https://good.test/start': { status: 302, headers: { location: 'https://evil.test/x' } }, 'https://evil.test/x': { status: 200, body: 'no' } }, seen);
  assert.equal((await safeGet('https://good.test/start', { maxBytes: 10, request: req, resolve })).reason, 'blocked-address');
  assert.deepEqual(seen, ['https://good.test/start', 'https://evil.test/x'], 'the second hop was attempted and refused at connect');
});

test('safeGet: at most 3 redirects, a relative Location resolves against the hop, a missing one fails', async () => {
  const resolve = resolveTo({ 'good.test': PUBLIC_IP });
  const chain = {};
  for (let i = 0; i < 5; i++) chain[`https://good.test/${i}`] = { status: 301, headers: { location: `/${i + 1}` } };
  chain['https://good.test/5'] = { status: 200, body: 'ok' };
  assert.equal((await safeGet('https://good.test/0', { maxBytes: 10, request: fakeRequest(chain), resolve })).reason, 'too-many-redirects');
  const short = { 'https://good.test/0': { status: 301, headers: { location: '/1' } }, 'https://good.test/1': { status: 200, body: 'ok', headers: { 'content-type': 'Image/PNG; x=1' } } };
  const ok = await safeGet('https://good.test/0', { maxBytes: 10, request: fakeRequest(short), resolve });
  assert.equal(ok.ok, true);
  assert.equal(ok.body.toString(), 'ok');
  assert.equal(ok.contentType, 'image/png');
  assert.equal(ok.finalUrl, 'https://good.test/1');
  assert.equal((await safeGet('https://good.test/0', { maxBytes: 10, request: fakeRequest({ 'https://good.test/0': { status: 302 } }), resolve })).reason, 'bad-redirect');
});

test('safeGet: the byte cap holds while streaming, and a declared Content-Length over it is refused up front', async () => {
  const resolve = resolveTo({ 'big.test': PUBLIC_IP });
  const streamed = fakeRequest({ 'https://big.test/a': { status: 200, chunks: ['12345', '67890', 'abcde'] } });
  assert.equal((await safeGet('https://big.test/a', { maxBytes: 12, request: streamed, resolve })).reason, 'too-large');
  const declared = fakeRequest({ 'https://big.test/a': { status: 200, headers: { 'content-length': '999999' }, body: 'x' } });
  assert.equal((await safeGet('https://big.test/a', { maxBytes: 12, request: declared, resolve })).reason, 'too-large');
  const fits = fakeRequest({ 'https://big.test/a': { status: 200, chunks: ['12345', '6789012'] } });
  assert.equal((await safeGet('https://big.test/a', { maxBytes: 12, request: fits, resolve })).body.length, 12, 'exactly at the cap is allowed');
});

test('safeGet: a host that never answers times out; an error status and an unreachable host fail softly', async () => {
  const resolve = resolveTo({ 'slow.test': PUBLIC_IP, 'err.test': PUBLIC_IP });
  assert.equal((await safeGet('https://slow.test/', { maxBytes: 10, timeoutMs: 30, request: fakeRequest({ 'https://slow.test/': { hang: true } }), resolve })).reason, 'timeout');
  assert.equal((await safeGet('https://err.test/', { maxBytes: 10, request: fakeRequest({ 'https://err.test/': { status: 404 } }), resolve })).reason, 'http-404');
  assert.equal((await safeGet('https://nowhere.test/', { maxBytes: 10, request: fakeRequest({}), resolve })).reason, 'unreachable');
  await assert.rejects(() => safeGet('https://err.test/', {}), /maxBytes is required/, 'a caller that forgets the cap is a programming error');
});
