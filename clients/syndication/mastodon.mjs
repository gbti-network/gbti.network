// SOW-058 + SOW-123: the Mastodon syndication adapter. Posts a status to the brand instance with a long-lived
// access token (the simplest social channel: no OAuth refresh, and Mastodon renders URLs, #hashtags, and
// @user@instance mentions NATIVELY in status text, so no facets are needed). SOW-123 finished the scaffold:
// it renders through the shared template system (the configured `mastodon` template + the members STUB chain,
// like X and Bluesky). Thin injectable-fetch client; no SDK.
//
// PROVISIONING (SOW-123): MASTODON_BASE_URL (the instance origin, e.g. https://mastodon.social) +
// MASTODON_ACCESS_TOKEN (a Development-app token with write:statuses). Free, so a normal auto channel. When
// unconfigured the drain records "skipped", never "failed".

import { secretsPresent } from '../../membership/syndication-channels.mjs';
import { renderChannelText } from '../../membership/syndication-render.mjs';

export function createMastodonAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
  return {
    name: 'mastodon',
    enabled() { return secretsPresent(env, 'mastodon'); },
    async post(item) {
      const base = String(env.MASTODON_BASE_URL || '').replace(/\/$/, '');
      // SOW-123: the shared per-channel text builder (the configured `mastodon` template, stub-aware for a
      // members-only item); the manual rail's already-sanitized textOverride wins. Mastodon auto-links the
      // URL, auto-tags the #hashtags, and resolves the @user@instance mention, so they ride in the text.
      const status = renderChannelText(cfg, item, 'mastodon', { textOverride: item.textOverride });
      const res = await fetchImpl(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res || !res.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        const detail = body?.error || (res ? `status ${res.status}` : 'no response');
        return { ok: false, error: `mastodon ${detail}`.slice(0, 160) };
      }
      const json = await res.json().catch(() => ({}));
      return { ok: true, id: json?.id || null, url: json?.url || null };
    },
  };
}
