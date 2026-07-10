// SOW-058 + SOW-088: the LinkedIn syndication adapter. Posts as the brand ORGANIZATION page (owner-decided)
// via the CURRENT versioned Posts API (POST /rest/posts + the LinkedIn-Version header) — the legacy
// /v2/ugcPosts this adapter used to call is unavailable to new LinkedIn apps. A share with a URL posts a
// RICH ARTICLE CARD (source + title + description), not a bare paragraph. Thin injectable-fetch client.
//
// PROVISIONING CAVEAT (SOW-088): organization posting requires a LinkedIn app VERIFIED against the company
// page with the "Community Management API" product approved, and an OAuth2 access token with
// w_organization_social. The token expires (~60 days) and must be refreshed; the credential-health probe
// warns when it dies. This adapter ships disabled until its secrets exist; when unconfigured it is recorded
// "skipped", never "failed". Runbook: .data/ops/secrets-ops/README.md (LinkedIn).

import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

// The pinned versioned-API month (LinkedIn retires versions after ~1 year; bump deliberately).
export const LINKEDIN_API_VERSION = '202506';

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
        commentary: text,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };
      // A URL posts as a rich article card (link + title + blurb); commentary-only otherwise.
      if (item.url) {
        body.content = { article: { source: String(item.url), ...(item.title ? { title: String(item.title).slice(0, 200) } : {}), ...(item.blurb ? { description: String(item.blurb).slice(0, 250) } : {}) } };
      }
      const res = await fetchImpl('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': env.LINKEDIN_API_VERSION || LINKEDIN_API_VERSION,
        },
        body: JSON.stringify(body),
      });
      if (!res || !res.ok) {
        // LinkedIn errors carry useful JSON; surface a snippet so the popup says WHY, not just a status.
        let detail = '';
        try { detail = (await res.text()).slice(0, 120); } catch { detail = ''; }
        return { ok: false, error: `linkedin ${res ? res.status : 'no response'}${detail ? ` ${detail}` : ''}` };
      }
      const id = res.headers?.get?.('x-restli-id') || null;
      return { ok: true, id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
    },
  };
}
