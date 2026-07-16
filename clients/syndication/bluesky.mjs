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
import { blueskyHandleFrom } from '../../membership/syndication-format.mjs';

/** The public web URL for a post from its at:// uri (at://did/app.bsky.feed.post/<rkey>) + the handle. Pure. */
export function blueskyWebUrl(uri, handle) {
  const rkey = String(uri || '').split('/').pop();
  const h = String(handle || '').replace(/^@/, '');
  return rkey && h ? `https://bsky.app/profile/${h}/post/${rkey}` : (uri || null);
}

/**
 * SOW-122: build a Bluesky rich-text MENTION facet over the first `@<handle>` occurrence in `text`, using the
 * UTF-8 byte range the AT protocol requires and the resolved `did`. Returns null when the handle/did is
 * missing or the `@handle` is not in the text. Pure. This is what makes the @handle a real, notifying mention
 * (a plain @handle in Bluesky text does not link on its own).
 */
export function mentionFacet(text, handle, did) {
  if (!handle || !did) return null;
  const s = String(text || '');
  const mentionText = `@${handle}`;
  const idx = s.indexOf(mentionText);
  if (idx < 0) return null;
  const enc = new TextEncoder();
  const byteStart = enc.encode(s.slice(0, idx)).length;
  const byteEnd = byteStart + enc.encode(mentionText).length;
  return { index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] };
}

/**
 * SOW-122: build rich-text TAG facets for every "#hashtag" in the text (the AT protocol tag feature carries
 * the tag WITHOUT the leading #), at UTF-8 byte ranges. A plain #tag in Bluesky text is not a clickable
 * hashtag on its own; this makes each one a real, searchable tag. Pure.
 */
export function hashtagFacets(text) {
  const s = String(text || '');
  const enc = new TextEncoder();
  const out = [];
  const re = /#(\w+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const byteStart = enc.encode(s.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    out.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }] });
  }
  return out;
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
      // SOW-122: rich-text FACETS make the #hashtags clickable tags and the author @handle a real mention
      // (a plain #tag / @handle in Bluesky text is inert on its own). Hashtag facets are pure; the mention
      // facet needs the handle resolved to a DID (fail-soft: a resolve miss leaves the plain @handle). Only
      // the member's OWN handle is faceted. Facets must be ordered by byte offset + non-overlapping.
      const facets = hashtagFacets(text);
      const handle = blueskyHandleFrom(item.authorBluesky);
      if (handle && text.includes(`@${handle}`)) {
        try {
          const rh = await fetchImpl(`${base}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
          const did = (rh && rh.ok) ? (await rh.json().catch(() => ({})))?.did : null;
          const mf = mentionFacet(text, handle, did);
          if (mf) facets.push(mf);
        } catch { /* fail-soft: no mention facet */ }
      }
      if (facets.length) record.facets = facets.sort((a, b) => a.index.byteStart - b.index.byteStart);

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
