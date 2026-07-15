// SOW-058 + SOW-120: the X (Twitter) syndication adapter. Posts a single tweet via the v2 POST /2/tweets
// endpoint, authorized with an OAuth 1.0a user-context signature (the brand account's consumer key/secret +
// access token/secret). The link rides in the tweet text and X auto-unfurls it into a link card.
//
// SOW-120 fixed two defects in the SOW-058 scaffold: (1) it sent the OAuth 1.0a access token as an OAuth 2.0
// bearer, which /2/tweets rejects with 401 (now it signs the request per RFC 5849); (2) it ignored the
// template system (now the AUTO rail renders the configured `x` channel template, stub-aware for a
// members-only item, exactly like the Reddit adapter). Thin injectable-fetch client; no SDK.
//
// PROVISIONING (SOW-120): X requires an app with Read + Write and the four OAuth 1.0a credentials
// (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET), generated in the developer portal. The Free
// tier (about 500 writes/month) covers co-op volume. When unconfigured the drain records "skipped", never
// "failed". The tokens are long-lived, so there is no refresh flow.

import { secretsPresent } from '../../membership/syndication-channels.mjs';
import { renderChannelText } from '../../membership/syndication-render.mjs';
import { authHeader } from './oauth1.mjs';

const TWEETS_URL = 'https://api.twitter.com/2/tweets';

export function createXAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
  return {
    name: 'x',
    enabled() { return secretsPresent(env, 'x'); },
    async post(item, { nonce, timestamp } = {}) {
      // SOW-121: the shared per-channel text builder (the AUTO rail renders the configured `x` template,
      // stub-aware; the MANUAL rail's already-sanitized textOverride wins). One source, so a manual-assist
      // Social Queue task carries the same text this adapter would have posted.
      const text = renderChannelText(cfg, item, 'x', { textOverride: item.textOverride });

      let header;
      try {
        header = await authHeader({
          method: 'POST',
          url: TWEETS_URL,
          consumerKey: env.X_API_KEY,
          consumerSecret: env.X_API_SECRET,
          token: env.X_ACCESS_TOKEN,
          tokenSecret: env.X_ACCESS_SECRET,
          nonce,
          timestamp,
        });
      } catch (err) {
        return { ok: false, error: `x sign ${(err?.message || 'failed').slice(0, 120)}` };
      }

      const res = await fetchImpl(TWEETS_URL, {
        method: 'POST',
        headers: { Authorization: header, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res || !res.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        const detail = body?.detail || body?.title || (body?.errors && body.errors[0] && (body.errors[0].message || body.errors[0].detail)) || (res ? `status ${res.status}` : 'no response');
        return { ok: false, error: `x ${detail}`.slice(0, 160) };
      }
      const json = await res.json().catch(() => ({}));
      const id = json?.data?.id || null;
      return { ok: true, id, url: id ? `https://x.com/i/web/status/${id}` : null };
    },
  };
}
