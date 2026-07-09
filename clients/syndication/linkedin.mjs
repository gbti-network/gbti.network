// SOW-058: the LinkedIn syndication adapter. Posts as the brand organization via the UGC Posts API with an OAuth2
// access token + the org URN. Thin injectable-fetch client; no SDK.
//
// PROVISIONING CAVEAT (SOW-058): LinkedIn requires an app with w_organization_social, the org URN, and an OAuth2
// access token that expires (~60 days) and must be refreshed. This adapter ships disabled until its secrets exist;
// when unconfigured it is recorded "skipped", never "failed".

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

export function createLinkedinAdapter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'linkedin',
    enabled() { return secretsPresent(env, 'linkedin'); },
    async post(item) {
      // SOW-088 manual syndicate: an already-rendered (sanitized) message wins over the built text.
      const text = (typeof item.textOverride === 'string' && item.textOverride.trim()) ? item.textOverride : buildChannelText(item, { limit: channelLimit('linkedin') });
      const author = String(env.LINKEDIN_ORG_URN || ''); // e.g. "urn:li:organization:12345"
      const body = {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };
      const res = await fetchImpl('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      });
      if (!res || !res.ok) return { ok: false, error: `linkedin ${res ? res.status : 'no response'}` };
      const id = res.headers?.get?.('x-restli-id') || null;
      return { ok: true, id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
    },
  };
}
