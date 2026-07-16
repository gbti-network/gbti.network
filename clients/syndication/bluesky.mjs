// SOW-058 + SOW-122: the Bluesky (AT protocol) syndication adapter. Authenticates with an app-password session
// (com.atproto.server.createSession) then creates an app.bsky.feed.post record as the brand account.
// SOW-122 finished the SOW-058 scaffold: it renders through the shared template system (the configured
// `bluesky` template + the members STUB chain, like the X adapter), attaches an EXTERNAL EMBED CARD so the
// link is a clickable preview (the AT protocol does not auto-link a bare URL in post text), and returns a real
// bsky.app web URL. Thin injectable-fetch client; no SDK.
//
// PROVISIONING (SOW-122): BLUESKY_HANDLE + BLUESKY_APP_PASSWORD (an app password from bsky.app Settings ->
// App Passwords, NOT the account password). Free, so a normal auto channel. When unconfigured the drain
// records "skipped", never "failed".

import { secretsPresent } from '../../membership/syndication-channels.mjs';
import { renderChannelText } from '../../membership/syndication-render.mjs';

/** The public web URL for a post from its at:// uri (at://did/app.bsky.feed.post/<rkey>) + the handle. Pure. */
export function blueskyWebUrl(uri, handle) {
  const rkey = String(uri || '').split('/').pop();
  const h = String(handle || '').replace(/^@/, '');
  return rkey && h ? `https://bsky.app/profile/${h}/post/${rkey}` : (uri || null);
}

export function createBlueskyAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
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

      // SOW-122: the shared per-channel text builder (the configured `bluesky` template, stub-aware for a
      // members-only item); the manual rail's already-sanitized textOverride wins. The default template omits
      // {url} because the embed card below carries the clickable link.
      const text = renderChannelText(cfg, item, 'bluesky', { textOverride: item.textOverride });
      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date(item.enqueuedAt || Date.now()).toISOString() };
      // SOW-122: a clickable link is an EXTERNAL EMBED CARD (uri + title + description). A members item's url
      // is its PUBLIC stub page, so the card is still safe (no gated body ever reaches here). Thumb deferred.
      if (item.url) {
        record.embed = {
          $type: 'app.bsky.embed.external',
          external: {
            uri: String(item.url),
            title: String(item.title || '').slice(0, 300),
            description: String(item.blurb || '').slice(0, 1000),
          },
        };
      }
      const res = await fetchImpl(`${base}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
      });
      if (!res || !res.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        const detail = body?.message || body?.error || (res ? `status ${res.status}` : 'no response');
        return { ok: false, error: `bluesky ${detail}`.slice(0, 160) };
      }
      const json = await res.json().catch(() => ({}));
      const uri = json?.uri || null;
      return { ok: true, id: uri, url: uri ? blueskyWebUrl(uri, env.BLUESKY_HANDLE) : null };
    },
  };
}
