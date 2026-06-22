// SOW-058: the X (Twitter) syndication adapter. Posts via the v2 POST /2/tweets endpoint with an OAuth2
// user-context bearer (X_ACCESS_TOKEN). Thin injectable-fetch client; no SDK.
//
// PROVISIONING CAVEAT (SOW-058): X requires an OAuth app + an OAuth2 user-context (or OAuth1.0a) token with write
// scope, and the free tier write cap is very low. This adapter ships disabled until its secrets exist; token
// acquisition/refresh is owner-provisioning (see the SOW). When unconfigured it is recorded "skipped", never
// "failed".

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

export function createXAdapter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'x',
    enabled() { return secretsPresent(env, 'x'); },
    async post(item) {
      const text = buildChannelText(item, { limit: channelLimit('x') });
      const res = await fetchImpl('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.X_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res || !res.ok) return { ok: false, error: `x ${res ? res.status : 'no response'}` };
      const json = await res.json().catch(() => ({}));
      const id = json?.data?.id || null;
      return { ok: true, id, url: id ? `https://x.com/i/web/status/${id}` : null };
    },
  };
}
