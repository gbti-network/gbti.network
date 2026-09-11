// The shares feed as ONE card grid (owner, 2026-09-11). For a paid or trial member, /feeds/shares/ used to
// reveal a "member stream" above the built cards, rendered by the account hub's element in the extension's
// row design; the owner wanted the site's cards only, with the members-only shares still there. So the
// members-only shares (and any share newer than the last deploy) the tier-gated /membership/shares route
// returns are drawn here as the SAME .feed-item card FeedList.astro builds, and slotted into the ladder by
// date. Pure and node-tested: the markup builder and the merge plan take plain data; the one DOM function at
// the bottom applies the plan and is guarded for a DOM-less import. The built page never changes for a
// signed-out or free reader, and no members-only share ever enters dist (SOW-136 guard).
//
// DRIFT GUARD: test/share-feed-cards.test.mjs reads FeedList.astro, FavoriteButton.astro and
// CollectionButton.astro and checks every class and data-* hook this template emits exists there. Change a
// hook in the Astro card and that test names the one to change here.
import { relativeTime } from './home-feed.mjs';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "<author>/<id>", the favorites / comments key a share carries everywhere on the site. */
export function shareSlug(share) {
  return share && share.author && share.id ? `${share.author}/${share.id}` : '';
}

/** The account hub's reading view for a share, which exists for every share a member may read (a members-only
 *  share has no public page, and a public one newer than the last deploy has none yet). */
export function shareReadHref(slug) {
  return `/account/#read=${encodeURIComponent(slug)}`;
}

function hostnameOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * One share as the feed card. `share` is a /membership/shares item ({ id, author, title, shortDescription, url,
 * image, tags, visibility, createdAt, comments? }); the options carry the site helpers the Astro card uses so
 * the client card names, links and pictures an author the same way.
 */
export function shareCardHtml(share, {
  now = Date.now(),
  avatarUrl = () => undefined,
  authorDisplay = (u) => `@${u}`,
  authorHref = (u) => `/members/${encodeURIComponent(u)}/`,
  fallbackImage = '',
} = {}) {
  const slug = shareSlug(share);
  const author = String(share.author || '');
  const members = String(share.visibility || 'members').toLowerCase() !== 'public';
  const ts = Date.parse(share.createdAt || '') || 0;
  const title = share.title || share.shortDescription || 'Shared a link';
  const excerpt = share.title && share.shortDescription ? share.shortDescription : '';
  const cover = typeof share.image === 'string' && share.image.trim() ? share.image.trim() : '';
  const domain = hostnameOf(share.url);
  const tags = (Array.isArray(share.tags) ? share.tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean).join(' ');
  const href = shareReadHref(slug);
  const av = avatarUrl(author);
  const initial = escapeHtml((authorDisplay(author) || author || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?');
  const comments = Number.isFinite(Number(share.comments)) ? Number(share.comments) : null;
  const e = escapeHtml;
  return `<article class="feed-item${cover ? '' : ' nocover'}" data-fi data-kind="share" data-author="${e(author)}" data-comments="${comments ?? 0}" data-visibility="${members ? 'members' : 'public'}" data-tags="${e(tags)}" data-cats="" data-share-slug="${e(slug)}" data-ts="${ts}" data-live-share>
  <div class="feed-main">
    <div class="feed-meta">
      <span class="av" style="position:relative;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;background:var(--fg-mute);color:#fff;font-family:var(--f-display);font-weight:700;width:26px;height:26px;font-size:11px;border-radius:999px"><span aria-hidden="true">${initial}</span>${av ? `<img src="${e(av)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border:0" />` : ''}</span>
      <span class="tmeta"><a class="who" href="${e(authorHref(author))}">${e(authorDisplay(author))}</a><span class="dotsep"></span>${e(relativeTime(ts, now))}</span>
      <span class="kind-tag kt-share">shared${domain ? ` · ${e(domain)}` : ''}</span>${members ? '<span class="kind-tag kt-members">members</span>' : ''}
    </div>
    <h2 class="feed-title"><a href="${e(href)}">${e(title)}</a></h2>
    ${excerpt ? `<p class="feed-ex">${e(excerpt)}</p>` : ''}
    <div class="feed-foot">
      <gbti-favorite data-gbti-target-type="share" data-gbti-target-slug="${e(slug)}" data-gbti-count="0" data-gbti-size="sm" data-gbti-region="favorite" class="gbti-favorite fav-sm"><button type="button" class="fav-pill" data-signin data-tooltip="Favorite" aria-label="Favorite this share"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><use href="#ico-heart" /></svg></button></gbti-favorite>
      <gbti-collection data-gbti-target-type="share" data-gbti-target-slug="${e(slug)}" data-gbti-size="sm" data-gbti-region="collection" class="gbti-collection col-sm"><button type="button" class="col-pill" data-signin data-tooltip="Save to a collection" aria-label="Save this share to a collection"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><use href="#ico-folder" /></svg><span class="col-label">Save</span></button></gbti-collection>
      <span class="feed-follow" data-follow-user="${e(author)}"><button type="button" class="follow-pill" data-signin data-tooltip="Follow" aria-label="Follow ${e(authorDisplay(author))}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><use href="#ico-mega"/></svg><span class="follow-t">Follow</span></button></span>
      ${comments != null ? `<span class="rx rx-static"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ico-chat"/></svg> ${comments}<span class="sr-only"> comments</span></span>` : ''}
      <span class="fsp"></span>
    </div>
  </div>
  ${(cover || fallbackImage) ? `<a class="feed-cover${cover ? '' : ' feed-cover-fb'}" href="${e(href)}" aria-hidden="true" tabindex="-1"><img src="${e(cover || fallbackImage)}" alt="" loading="lazy" decoding="async" /></a>` : ''}
</article>`;
}

/**
 * Where each live share goes in the built ladder. `existing` = the built cards in DOM order (newest first), each
 * { slug, ts }. A share the build already carries is dropped (the built card stays the record); the rest sort
 * newest first and each names the built card to sit BEFORE (the first with a smaller timestamp), or null to
 * go after the last card. Pure.
 */
export function planShareMerge(existing, shares) {
  const have = new Set((Array.isArray(existing) ? existing : []).map((c) => c && c.slug).filter(Boolean));
  const fresh = (Array.isArray(shares) ? shares : [])
    .filter((s) => s && shareSlug(s) && !have.has(shareSlug(s)))
    .map((s) => ({ share: s, ts: Date.parse(s.createdAt || '') || 0 }))
    .sort((a, b) => b.ts - a.ts);
  const seen = new Set();
  const out = [];
  for (const f of fresh) {
    const slug = shareSlug(f.share);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const before = (Array.isArray(existing) ? existing : []).find((c) => c && Number(c.ts) < f.ts);
    out.push({ share: f.share, beforeSlug: before ? before.slug : null });
  }
  return out;
}

/**
 * Apply the plan to a built feed list (the [data-feedlist] element): each card lands in whichever ladder chunk
 * holds its neighbour (a hidden chunk stays hidden and reveals with Next), and the list announces
 * `feed-rows-changed` so the view's filters re-collect the rows. Returns the number of cards added.
 */
export function mergeSharesIntoFeed(list, shares, opts = {}) {
  if (typeof document === 'undefined' || !list) return 0;
  const cards = Array.from(list.querySelectorAll('[data-fi][data-share-slug]'));
  const existing = cards.map((c) => ({ slug: c.getAttribute('data-share-slug') || '', ts: Number(c.getAttribute('data-ts')) || 0 }));
  const plan = planShareMerge(existing, shares);
  let added = 0;
  for (const p of plan) {
    const html = shareCardHtml(p.share, opts);
    const ref = p.beforeSlug ? list.querySelector(`[data-fi][data-share-slug="${CSS.escape(p.beforeSlug)}"]`) : null;
    if (ref) { ref.insertAdjacentHTML('beforebegin', html); added++; continue; }
    const chunks = list.querySelectorAll('.feed-chunk');
    const last = chunks[chunks.length - 1];
    if (last) { last.insertAdjacentHTML('beforeend', html); added++; }
  }
  if (added) list.dispatchEvent(new CustomEvent('feed-rows-changed', { bubbles: true, detail: { added } }));
  return added;
}
