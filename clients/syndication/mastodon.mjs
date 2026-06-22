// SOW-058: the Mastodon syndication adapter. Posts a status to the brand instance with a long-lived access token
// (the simplest of the social channels: no OAuth refresh dance). Thin injectable-fetch client; no SDK.

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

export function createMastodonAdapter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'mastodon',
    enabled() { return secretsPresent(env, 'mastodon'); },
    async post(item) {
      const base = String(env.MASTODON_BASE_URL || '').replace(/\/$/, '');
      const status = buildChannelText(item, { limit: channelLimit('mastodon') });
      const res = await fetchImpl(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res || !res.ok) return { ok: false, error: `mastodon ${res ? res.status : 'no response'}` };
      const json = await res.json().catch(() => ({}));
      return { ok: true, id: json?.id || null, url: json?.url || null };
    },
  };
}
