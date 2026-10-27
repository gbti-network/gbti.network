// sow-484 (owner, 2026-10-27: "We need to make sure that the weekly newsletter is included into our social queue
// preparation"). Once a weekly issue has gone out, enqueue ONE syndication item for its public web edition, so the
// drain prepares Social Queue tasks for it exactly as it does for an article: one per channel whose `newsletter`
// cell in the channel matrix is On-Manual, with the newsletter template's text.
//
// ONLY ONCE THE PAGE ANSWERS. issueWasSent is the web edition's own rule (mail-web-route.mjs), so a post can never
// link /digest/<id> before that page serves. Only a canonical weekly id (WEB_EDITION_ID_RE) qualifies, so a members
// edition, a welcome issue, a rehearsal or an alert never produces a post.
//
// ONCE PER ISSUE. The syndication store's own dedupe forgets an item once it is cancelled, failed or expired, and
// this step runs every five minutes, so a post the owner deleted would come straight back. A permanent marker per
// issue, written only once the item is queued (or found already queued), is what makes it once.
//
// THE LAST SIX DAYS ONLY. Every issue that ever went out still passes issueWasSent (its stats snapshot has no TTL),
// so an unbounded walk would queue a post for every past issue on the first run. Six days holds exactly one Tuesday.
//
// Fail-soft and cheap: one config read when syndication is off or no channel takes the newsletter, otherwise six
// marker reads a tick once the week's issue is queued.

import { webEditionUrl } from '../../membership/mail-render-parts.mjs';
import { issueHeadline, DIGEST_OG_IMAGE } from '../../membership/mail-render.mjs';
import { resolveSiteUrl, resolveClickBase } from '../../membership/mail-click.mjs';
import { weeklyIssueId } from '../../membership/mail-compile-core.mjs';
import { isSyndicationEnabled, deliverChannelsForType } from '../../membership/syndication-config-core.mjs';
import { getIssue } from './mail-store.mjs';
import { issueWasSent } from './mail-web-route.mjs';
import { enqueue, readSyndicationConfig } from './syndication-store.mjs';

export const NEWSLETTER_SOURCE = 'newsletter';
export const NEWSLETTER_RECENT_DAYS = 6;
export const newsletterSocialKey = (issueId) => `mail:social:${issueId}`;

/** The weekly ids of the last `days` UTC days, newest first. A weekly id is the UTC date it was compiled on. */
export function recentWeeklyIds(nowMs, days = NEWSLETTER_RECENT_DAYS) {
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(weeklyIssueId(Number(nowMs) - i * 86400000));
  return out;
}

/** The public syndication input for a sent weekly issue, or null when it has no web edition to link. Pure. */
export function newsletterItem(issue, { webBase, siteUrl } = {}) {
  const issueId = String(issue?.issueId || '').trim();
  const url = webEditionUrl(webBase, issueId); // '' for anything but a canonical weekly id (WEB_EDITION_ID_RE)
  if (!url) return null;
  const { subject, summary } = issueHeadline(issue);
  const site = String(siteUrl || '').replace(/\/+$/, '');
  return {
    source: NEWSLETTER_SOURCE,
    targetType: NEWSLETTER_SOURCE,
    targetSlug: issueId,
    visibility: 'public', // buildQueueItem reads anything else as members-only, which closes every channel
    title: subject,
    blurb: summary, // {short-description}
    url,
    image: site ? `${site}${DIGEST_OG_IMAGE}` : null,
  };
}

export async function queueNewsletterPosts(env, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  readConfig = readSyndicationConfig,
  enqueueItem = enqueue,
  wasSent = issueWasSent,
  readIssue = getIssue,
  days = NEWSLETTER_RECENT_DAYS,
} = {}) {
  if (!kv) return { reason: 'no kv' };
  const cfg = await readConfig(kv);
  if (!isSyndicationEnabled(cfg)) return { reason: 'syndication off' };
  if (deliverChannelsForType(cfg, NEWSLETTER_SOURCE).length === 0) return { reason: 'no channel takes the newsletter' };
  const nowMs = Number(now());
  const webBase = resolveClickBase(env);
  const siteUrl = resolveSiteUrl(env);
  const queued = [];
  const waiting = [];
  for (const issueId of recentWeeklyIds(nowMs, days)) {
    // An unreadable marker skips rather than queues: queueing on a read error is the path that repeats every tick.
    let marker;
    try { marker = await kv.get(newsletterSocialKey(issueId)); } catch { continue; }
    if (marker) continue;
    const issue = await readIssue(kv, issueId);
    if (!issue) continue;
    if (!(await wasSent(kv, issueId))) { waiting.push(issueId); continue; }
    const item = newsletterItem(issue, { webBase, siteUrl });
    if (!item) continue;
    const res = await enqueueItem(env, item, { kv, now, cfg });
    if (!res?.enqueued && res?.reason !== 'duplicate') continue; // not queued: the next tick tries again
    await kv.put(newsletterSocialKey(issueId), JSON.stringify({ queuedAt: nowMs, itemId: res.id ?? null }));
    queued.push(issueId);
  }
  return { queued, waiting };
}
