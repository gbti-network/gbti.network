// sow-437: the site's one edge function. On the invitation page (/claim/?code=) it serves the static page with the
// invitation's personal title in <title> and og:title, so the browser tab and a pasted link's preview read, for
// example, "Rob, your Devote listing on GBTI Network". The owner chose this knowing the preview then shows both.
//
// FAIL CLOSED TO THE GENERIC PAGE. No code, a malformed code, a dead link, a slow or failed lookup, a non-HTML
// response, or a page whose head no longer matches: the visitor gets exactly the static page. The lookup is the
// signup Worker's GET /invite/title, which answers the same opaque 404 as the page read for every dead link.
//
// The personalized response is never cached (it is about one person), and every header of the static response,
// including the site's security headers, is carried over. Never logs: the code is a bearer secret.

import { personalizeHead, claimCodeFrom } from '../../src/lib/invite-head.mjs';

const SIGNUP_BASE = 'https://signup.gbti.network';
const LOOKUP_TIMEOUT_MS = 1500;

export async function onRequest(context) {
  const res = await context.next();
  if (context.request.method !== 'GET') return res;
  const code = claimCodeFrom(context.request.url);
  if (!code || !res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  let title = '';
  try {
    const r = await fetch(`${SIGNUP_BASE}/invite/title?code=${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (r.ok) {
      const body = await r.json();
      if (body && body.ok === true && typeof body.title === 'string') title = body.title;
    }
  } catch {
    title = '';
  }
  if (!title) return res;

  const html = await res.text();
  const { html: out, changed } = personalizeHead(html, title);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  if (changed) headers.set('cache-control', 'no-store');
  return new Response(changed ? out : html, { status: res.status, statusText: res.statusText, headers });
}
