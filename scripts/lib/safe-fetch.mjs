// sow-283 / sow-272: fetch a MEMBER-SUPPLIED URL from CI without letting the member choose what CI connects to.
// A share's link and its preview image are authored by a member; the share-covers workflow fetches them from a
// GitHub-hosted runner, which can reach a cloud metadata endpoint and whatever else the runner's network allows.
// That is server-side request forgery by construction unless every one of these holds:
//
//   - https only, on the default port, with no credentials in the URL
//   - an IP literal host is checked directly (Node never calls `lookup` for one)
//   - every name is resolved THROUGH A GUARDED LOOKUP passed to the socket, so the address checked is the address
//     connected to. Resolving first and fetching second would leave a DNS-rebinding gap between the two.
//   - redirects are followed by hand, at most 3, and each hop goes through all of the above again
//   - the body is capped while streaming (a lying Content-Length changes nothing) and every request has a timeout
//
// Nothing here throws for a refused or failed fetch: the result carries `ok: false` and a short `reason`, so a
// hostile or broken URL can only ever cost one share its image, never the run.
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Parse an IPv4 dotted quad to 4 bytes, or null. */
function v4Bytes(s) {
  const parts = String(s).split('.');
  if (parts.length !== 4) return null;
  const out = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return out.every((n) => n >= 0 && n <= 255) ? out : null;
}

/** Parse an IPv6 address (with `::` and an optional trailing dotted IPv4) to 16 bytes, or null. */
function v6Bytes(s) {
  let str = String(s).replace(/^\[|\]$/g, '').split('%')[0];
  let tail = [];
  const lastColon = str.lastIndexOf(':');
  if (str.includes('.') && lastColon !== -1) {
    const v4 = v4Bytes(str.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    str = `${str.slice(0, lastColon)}:0:0`; // two placeholder groups, replaced by the v4 bytes below
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const groups = (h) => (h ? h.split(':') : []);
  const head = groups(halves[0]);
  const back = halves.length === 2 ? groups(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - back.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...back];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const bytes = all.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function v4Blocked([a, b, c]) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this-network, private, loopback, multicast + reserved + broadcast
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // TEST-NET-2, TEST-NET-3
  );
}

/**
 * True when an IP address (v4 or v6 text) must never be connected to. Anything unparseable is blocked: this
 * function's only callers are about to open a socket, and "could not tell" must not read as "public".
 */
export function isBlockedAddress(ip) {
  const family = net.isIP(String(ip || '').replace(/^\[|\]$/g, '').split('%')[0]);
  if (family === 4) return v4Blocked(v4Bytes(ip));
  if (family !== 6) return true;
  const b = v6Bytes(ip);
  if (!b) return true;
  const zeroTo = (n) => b.slice(0, n).every((x) => x === 0);
  if (zeroTo(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (zeroTo(10) && b[10] === 0xff && b[11] === 0xff) return v4Blocked(b.slice(12)); // IPv4-mapped
  if (zeroTo(12)) return true; // deprecated IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; // NAT64 can reach anything
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((x) => x === 0)) return true; // discard 100::/64
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 6to4 embeds an arbitrary IPv4
  if ((b[0] & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // site-local fec0::/10
  if (b[0] === 0xff) return true; // multicast
  return false;
}

/**
 * Validate a URL before any socket opens. Returns { ok: true, url } or { ok: false, reason }. Decodes the `&amp;`
 * that an HTML attribute leaves in a stored URL (two real shares carry one) before parsing.
 */
export function checkTarget(raw) {
  let url;
  try { url = new URL(String(raw || '').trim().replace(/&amp;/g, '&')); } catch { return { ok: false, reason: 'bad-url' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'port' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const dotless = !host.includes('.') && !net.isIP(host); // a single-label name resolves through the runner's search domains
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/i.test(host) || dotless) {
    return { ok: false, reason: 'blocked-host' };
  }
  if (net.isIP(host) && isBlockedAddress(host)) return { ok: false, reason: 'blocked-address' };
  return { ok: true, url };
}

/**
 * A `lookup` for the socket that refuses to hand back a blocked address. EVERY address a name resolves to must be
 * public: a name with one public and one private record is refused, since the socket may try either.
 */
export function guardedLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    const opts = typeof options === 'function' ? {} : options || {};
    const cb = typeof options === 'function' ? options : callback;
    resolve(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
      if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
        const e = new Error(`blocked address for ${hostname}`);
        e.code = 'EBLOCKED';
        return cb(e);
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

/** One request, no redirect handling. Resolves { status, headers, body } or { error }. Never rejects. */
function requestOnce(url, { request, lookup, timeoutMs, maxBytes, accept }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    let req;
    const timer = setTimeout(() => { done({ error: 'timeout' }); req?.destroy(); }, timeoutMs);
    try {
      req = request(url, {
        method: 'GET',
        lookup,
        headers: { 'User-Agent': 'gbti-network-share-covers/1.0 (+https://gbti.network)', Accept: accept, 'Accept-Encoding': 'identity' },
      }, (res) => {
        const status = res.statusCode || 0;
        if (REDIRECT_STATUSES.has(status) || status < 200 || status >= 300) {
          res.resume();
          return done({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); return done({ error: 'too-large' }); }
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > maxBytes) { res.destroy(); return done({ error: 'too-large' }); }
          chunks.push(c);
        });
        res.on('end', () => done({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', () => done({ error: 'read-failed' }));
      });
      req.on('error', (e) => done({ error: e && e.code === 'EBLOCKED' ? 'blocked-address' : 'unreachable' }));
      req.end();
    } catch {
      done({ error: 'unreachable' });
    }
  });
}

/**
 * GET a member-supplied URL under every control above. Returns
 * { ok: true, status, contentType, body, finalUrl } or { ok: false, reason }.
 *
 * @param {string} raw
 * @param {{ maxBytes: number, timeoutMs?: number, accept?: string, maxRedirects?: number,
 *           request?: Function, resolve?: Function }} opts  request/resolve are injectable for tests
 */
export async function safeGet(raw, { maxBytes, timeoutMs = 8000, accept = '*/*', maxRedirects = 3, request = https.request, resolve = dns.lookup } = {}) {
  if (!(maxBytes > 0)) throw new Error('safeGet: maxBytes is required');
  const lookup = guardedLookup(resolve);
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = checkTarget(current);
    if (!target.ok) return { ok: false, reason: target.reason };
    const res = await requestOnce(target.url, { request, lookup, timeoutMs, maxBytes, accept });
    if (res.error) return { ok: false, reason: res.error };
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers?.location;
      if (!location) return { ok: false, reason: 'bad-redirect' };
      try { current = new URL(location, target.url).toString(); } catch { return { ok: false, reason: 'bad-redirect' }; }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}` };
    const contentType = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    return { ok: true, status: res.status, contentType, body: res.body, finalUrl: target.url.toString() };
  }
  return { ok: false, reason: 'too-many-redirects' };
}
