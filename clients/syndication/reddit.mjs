// SOW-088: the Reddit syndication adapter, ported from the owner's Radle WordPress plugin (the authority
// for the OAuth + submit contract). Posts a LINK to the community subreddit as the brand account:
//   1. refresh an access token (https://www.reddit.com/api/v1/access_token, HTTP Basic client_id:secret,
//      grant_type=refresh_token; the refresh token comes from a duration=permanent authorize and is
//      long-lived) — stateless per post, fine at our volume;
//   2. POST https://oauth.reddit.com/api/submit with Bearer + Reddit's REQUIRED User-Agent, kind=link
//      (sr, title, url). Improvement over Radle: `api_type: 'json'` makes the response clean JSON
//      (json.data.id/url) instead of the legacy jquery-array walk.
// A url-less item posts kind=self with the text as the body. Thin injectable-fetch client; no SDK.
//
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_SUBREDDIT. Mint/renew the
// refresh token with scripts/reddit-auth.mjs (the app's redirect URI must be localhost:8976/callback).

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

const USER_AGENT = 'cloudflare-worker:network.gbti.syndication:v0.1 (by /u/gbti_network)';

async function refreshAccessToken(env, fetchImpl) {
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.REDDIT_REFRESH_TOKEN }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`reddit token refresh failed (${res.status}); the refresh token may be revoked — re-mint via scripts/reddit-auth.mjs`);
  return body.access_token;
}

export function createRedditAdapter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'reddit',
    enabled() { return secretsPresent(env, 'reddit'); },
    async post(item) {
      // SOW-088 manual syndicate: the rendered template IS the Reddit post title (an already-sanitized
      // override wins over the built text). Reddit titles cap at 300.
      const title = ((typeof item.textOverride === 'string' && item.textOverride.trim()) ? item.textOverride : buildChannelText(item, { limit: channelLimit('reddit'), includeUrl: false })).slice(0, channelLimit('reddit'));
      let token;
      try { token = await refreshAccessToken(env, fetchImpl); }
      catch (err) { return { ok: false, error: err.message }; }
      const params = { sr: String(env.REDDIT_SUBREDDIT || ''), title, api_type: 'json', resubmit: 'true' };
      // Radle-style post kinds: an explicit item.redditKind wins ('self' = a text post whose body is the
      // Worker-rendered item.bodyText); the default stays a LINK post. Reddit also accepts body text ON a
      // link post, so a provided bodyText rides along either way.
      const self = item.redditKind === 'self' || !item.url; // no url can never be a link post
      if (self) { params.kind = 'self'; params.text = String(item.bodyText || item.url || ''); }
      else { params.kind = 'link'; params.url = String(item.url); if (item.bodyText) params.text = String(item.bodyText); }
      const res = await fetchImpl('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams(params).toString(),
      });
      if (res.status === 429) return { ok: false, error: 'reddit 429 (rate limited)' };
      const body = await res.json().catch(() => ({}));
      const errors = body?.json?.errors;
      if (!res.ok || (Array.isArray(errors) && errors.length)) {
        const first = Array.isArray(errors) && errors.length ? errors[0].join(' ') : `status ${res.status}`;
        return { ok: false, error: `reddit ${first}`.slice(0, 160) };
      }
      const id = body?.json?.data?.id || body?.json?.data?.name || null;
      const url = body?.json?.data?.url || null;
      return { ok: true, id, url };
    },
  };
}
