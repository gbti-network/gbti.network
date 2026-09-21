// sow-383: GET /digest/<issueId>, the web edition of a weekly digest issue. The page the email's "View this issue
// on the web" link opens, and the one a reader shares.
//
// IT IS THE SAME RENDER AS THE EMAIL. renderIssue with ctx.edition 'web' walks the same frozen issue through the
// same item template, so the web page cannot show different items from the ones that were mailed. The frozen
// issue has no TTL (mail-store.mjs putIssue: "the per-issue public archive keeps it"), so a shared link keeps
// working after the per-recipient records expire.
//
// ONLY THE PUBLIC EDITION, AND ONLY ONCE IT HAS GONE OUT. The id must be a canonical weekly id, so a members
// edition, a welcome issue and a rehearsal are never published, and the issue must have delivered to at least one
// reader, so nothing composed and never sent becomes a public page. The public edition carries public items only
// (composeIssue's audience guard), so the page publishes nothing that is not already on the site.
//
// No reader identity is read or recorded, and the page carries no click counter or open pixel: a web visitor is
// not an email reader, and counting one would inflate the issue's numbers.
import { getIssue } from './mail-store.mjs';
import { pageResponse, escapePage } from './mail-pages.mjs';
import { renderIssue } from '../../membership/mail-render.mjs';
import { WEB_EDITION_ID_RE, webEditionUrl } from '../../membership/mail-render-parts.mjs';
import { statsKey } from '../../membership/mail-stats.mjs';
import { DIGEST_CONFIG_KV_KEY, resolveDigestConfig } from '../../membership/digest-config.mjs';
import { resolveSiteUrl, resolveClickBase } from '../../membership/mail-click.mjs';

/**
 * Has this issue delivered to anyone? The durable snapshot answers once sending finished; while it is still
 * going out, one delivered record is enough, read from a bounded first page so a request never walks the list.
 */
export async function issueWasSent(kv, issueId) {
  try {
    const stats = await kv.get(statsKey(issueId), 'json');
    if (Number(stats?.sent) > 0) return true;
  } catch { /* fall through to the records */ }
  try {
    const res = await kv.list({ prefix: `mail:send:${issueId}:`, limit: 50 });
    for (const k of res?.keys ?? []) {
      let rec = null;
      try { rec = await kv.get(k.name, 'json'); } catch { rec = null; }
      if (rec?.status === 'sent') return true;
    }
  } catch { /* unreadable: not shown */ }
  return false;
}

function notFound(siteUrl) {
  return pageResponse('Issue not available',
    '<h1>That issue is not available.</h1>'
    + '<p>Only digest issues that have gone out are published here. '
    + `The latest from the network is on <a href="${escapePage(siteUrl)}/feeds/">the feed</a>.</p>`, 404);
}

export async function handleDigestWeb(request, env, { kv = env?.SIGNUP_KV } = {}) {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const siteUrl = resolveSiteUrl(env);
  let id = '';
  try { id = decodeURIComponent(new URL(request.url).pathname.slice('/digest/'.length)).replace(/\/+$/, ''); } catch { id = ''; }
  if (!kv || !WEB_EDITION_ID_RE.test(id)) return notFound(siteUrl);

  const issue = await getIssue(kv, id);
  if (!issue || !(await issueWasSent(kv, id))) return notFound(siteUrl);

  // The owner's standing digest settings (the pitch switch, a sponsor), read live as the drain reads them.
  let digestConfig;
  try { digestConfig = resolveDigestConfig({ mirror: (await kv.get(DIGEST_CONFIG_KV_KEY, 'json')) ?? null }); }
  catch { digestConfig = resolveDigestConfig({ mirror: null }); }

  const { html } = renderIssue(issue, {
    edition: 'web',
    siteUrl,
    digestConfig,
    canonicalUrl: webEditionUrl(resolveClickBase(env), id),
    subscribeAction: '/mail/subscribe',
  });
  return new Response(method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A sent issue never changes its items, but the settings it renders with can, so a short cache.
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
