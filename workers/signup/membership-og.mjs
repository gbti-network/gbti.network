// SOW-057: POST /membership/og-preview — fetch a link's OpenGraph preview SERVER-SIDE so the share composer can
// prefill a featured image (the browser/extension cannot fetch arbitrary cross-origin pages). Returns
// { ok, image, title, description }. Authenticated by the GitHub bearer token (any signed-in member; a trial may
// stage drafts). The fetch is SSRF-guarded (no private/loopback/link-local/metadata targets), bounded, timed out,
// and NEVER throws (a bad target page returns { ok: true, image: null }).
//
// Uses the shared regex scraper (workers/lib/og-scrape.mjs). Pure over injected deps (fetchImpl/fetchUser), so it
// is unit-tested with fakes (no network, no secrets).

import { githubFetchUser } from './oauth.mjs';
import { scrapeOgPreview } from '../lib/og-scrape.mjs';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 60000;

// IPv4 literal -> blocked if loopback/private/link-local/this-network.
function isBlockedIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true; // private / loopback / this-network
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isBlockedHost(host) {
  // WHATWG URL keeps IPv6 hosts bracketed (e.g. "[::1]"); strip the brackets and a trailing dot before matching.
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 loopback/link-local/ULA
  if (isBlockedIpv4(h)) return true;
  return false;
}

/** Validate an author-supplied URL for a safe outbound fetch. Returns { ok, url } or { ok:false }. */
export function safeFetchTarget(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'only http(s) URLs are allowed' };
  if (u.username || u.password) return { ok: false, reason: 'credentials in the URL are not allowed' };
  if (isBlockedHost(u.hostname)) return { ok: false, reason: 'that host is not allowed' };
  return { ok: true, url: u.toString() };
}

async function authMember(request, { fetchImpl, fetchUser }) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };
  let user;
  try {
    user = await fetchUser(token, fetchImpl);
  } catch {
    return { ok: false, status: 401, body: { error: 'unauthorized', message: 'could not verify the GitHub token' } };
  }
  if (!user?.githubId) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'the GitHub token has no user id' } };
  return { ok: true, githubId: String(user.githubId) };
}

export async function handleOgPreview(request, env, {
  fetchImpl = globalThis.fetch,
  fetchUser = githubFetchUser,
} = {}) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  const a = await authMember(request, { fetchImpl, fetchUser });
  if (!a.ok) return a;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } };
  }

  const target = safeFetchTarget(payload?.url);
  if (!target.ok) return { status: 400, body: { error: 'invalid_url', message: target.reason } };

  // Bounded, timed-out fetch. Any failure returns a clean empty preview (never a 500), since an OG miss is normal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(target.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'gbti-link-preview/0.1 (+https://gbti.network)', Accept: 'text/html,application/xhtml+xml' },
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    if (!res || !res.ok) return { status: 200, body: { ok: true, image: null, title: null, description: null } };
    const ct = res.headers?.get?.('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return { status: 200, body: { ok: true, image: null, title: null, description: null } };
    let html = await res.text();
    if (typeof html === 'string' && html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
    const preview = scrapeOgPreview(html, target.url);
    return {
      status: 200,
      body: { ok: true, image: preview.image || null, title: preview.title || null, description: preview.description || null },
    };
  } catch {
    return { status: 200, body: { ok: true, image: null, title: null, description: null } };
  } finally {
    clearTimeout(timer);
  }
}
