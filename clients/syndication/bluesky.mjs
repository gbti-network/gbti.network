// SOW-058: the Bluesky syndication adapter. Authenticates with an app password (com.atproto.server.createSession)
// then creates an app.bsky.feed.post record. Thin injectable-fetch client; no SDK. The link rides in the post text
// (a richer facets-based link card is a future enhancement).

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

export function createBlueskyAdapter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const base = (env.BLUESKY_BASE_URL || 'https://bsky.social').replace(/\/$/, '');
  return {
    name: 'bluesky',
    enabled() { return secretsPresent(env, 'bluesky'); },
    async post(item) {
      const auth = await fetchImpl(`${base}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }),
      });
      if (!auth || !auth.ok) return { ok: false, error: `bluesky auth ${auth ? auth.status : 'no response'}` };
      const session = await auth.json().catch(() => ({}));
      if (!session?.accessJwt || !session?.did) return { ok: false, error: 'bluesky session missing tokens' };

      const text = buildChannelText(item, { limit: channelLimit('bluesky') });
      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date(item.enqueuedAt || Date.now()).toISOString() };
      const res = await fetchImpl(`${base}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
      });
      if (!res || !res.ok) return { ok: false, error: `bluesky post ${res ? res.status : 'no response'}` };
      const json = await res.json().catch(() => ({}));
      return { ok: true, id: json?.uri || null, url: json?.uri || null };
    },
  };
}
