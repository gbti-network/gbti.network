// SOW-057: the client read path for a link's OpenGraph preview, via the signup Worker's POST /membership/og-preview
// (the browser/extension cannot fetch arbitrary cross-origin pages; the Worker fetches it server-side, SSRF-guarded).
// Thin injectable fetch wrapper that sends the GitHub bearer token. Returns { ok, image, title, description }; never
// throws on a bad target page (the Worker returns image:null), only on auth/transport failures.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class OgClientError extends Error {}

export async function ogPreview({ url, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new OgClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/og-preview', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new OgClientError(data?.message || data?.error || `og-preview request failed (${res.status})`);
  return data;
}
