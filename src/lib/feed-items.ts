// SOW-136 / sow-131: the shared normalized feed item + its builders, extracted from the homepage so
// the /feeds/ views render the exact same rows. One `FeedItem` per content entry or public share;
// `targetType` keys favorites/comments, `kind` labels the card.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { isPublic, isDiscoverable, isMembersDiscoverable, isStub, catalogHref } from './content'; // sow-189 + sow-323: public discovery, and the members-only cards a paying member sees
import { buildAvatarIndex, type AvatarIndex } from './avatars';
import { favoriteCount } from './favorites';
import { commentThreadCount } from './comments';
import { resolveThumb } from './index-thumb';
import { imageFieldOf } from './content-index.mjs';
import { defaultFeatureImage } from './feature-image';
import { shareImageForSite } from '../../membership/share-cover-url.mjs';
import { feedTime, isPublicShare, readMinutes, decodeEntities } from './home-feed.mjs';
// sow-381: the card's category pill. TWO VOCABULARIES, because the content types and shares have always had
// two: an article/project/prompt carries `categories`, an ordered path into house/taxonomy.yml, and a share
// carries `category`, one flat key from house/topics.yml (SOW-080 decoupled them on purpose). Both resolve to
// a display label here so the template stays dumb and neither vocabulary leaks into the markup.
import { leafLabel, leafKey, topicLabel } from './taxonomy';

export type FeedItem = {
  kind: 'article' | 'project' | 'prompt' | 'share';
  targetType: 'post' | 'project' | 'prompt' | 'share';
  slug: string; // the favorites/comments key: content slug, or "<author>/<id>" for a share
  title: string;
  href: string | null;
  external: boolean;
  author: string;
  date: number;
  excerpt?: string;
  stub: boolean;
  favorites: number;
  comments: number;
  tags: string[];
  categories: string[]; // sow-174: the full category PATH, so any breadcrumb depth can filter
  category?: string; // sow-381: the resolved DISPLAY label for the card pill ("Music", "Accessibility"), or absent
  // sow-382: the KEY behind that label, which is what ?cat= matches on. A share's topic key and a content
  // leaf key land in the same `data-cats` token list, so `wordpress` on a share and `wordpress` on an
  // article answer the same click. The 13 share-only keys (music among them) simply match no content,
  // which is correct rather than a gap.
  categoryKey?: string;
  thumb: string | null; // small square (always resolvable, branded fallback)
  cover: string | null; // wide feed cover (only when the item has a real image)
  srcDomain?: string; // share: the shared link's hostname
  read?: number; // article: minutes
};

async function contentItem(entry: any, kind: 'article' | 'project' | 'prompt', comments: CollectionEntry<'comment'>[]): Promise<FeedItem> {
  const d = entry.data;
  const tt: 'post' | 'project' | 'prompt' = kind === 'article' ? 'post' : kind === 'prompt' ? 'prompt' : 'project';
  const hasImage = !!imageFieldOf(d, tt);
  const thumbs = await resolveThumb(d, tt);
  return {
    kind,
    targetType: tt,
    slug: d.slug,
    title: d.title,
    href: kind === 'article' ? `/articles/${d.slug}/` : kind === 'prompt' ? `/prompts/${d.slug}/` : catalogHref(entry),
    external: false,
    author: d.author,
    date: feedTime(d),
    excerpt: d.excerpt ?? d.shortDescription,
    stub: isStub(entry),
    favorites: favoriteCount(tt, d.slug),
    comments: commentThreadCount(comments, tt, d.slug, d.author),
    tags: d.tags ?? [],
    categories: d.categories ?? [],
    // The LEAF, not the whole path: a card shows "Accessibility", a detail page shows the breadcrumb.
    category: leafLabel(d.categories) || undefined,
    categoryKey: leafKey(d.categories) || undefined,
    thumb: thumbs.thumb,
    cover: hasImage ? thumbs.thumbCard : null,
    read: kind === 'article' ? readMinutes(entry.body) : undefined,
  };
}

function shareItem(entry: any, comments: CollectionEntry<'comment'>[]): FeedItem {
  const d = entry.data;
  const slug = `${d.author}/${d.id}`;
  let srcDomain: string | undefined;
  try { srcDomain = d.url ? new URL(d.url).hostname.replace(/^www\./, '') : undefined; } catch { srcDomain = undefined; }
  return {
    kind: 'share',
    targetType: 'share',
    slug,
    title: decodeEntities(d.title ?? d.shortDescription ?? 'Shared a link'),
    href: `/shares/${slug}/`, // sow-094: the share's own expanded view (the external CTA lives there)
    external: false,
    author: d.author,
    date: feedTime(d),
    excerpt: d.title && d.shortDescription ? decodeEntities(d.shortDescription) : undefined,
    stub: false,
    // owner QA 2026-07-22: the site presents LIKES (the favorites store) on shares, same as every other kind.
    // sow-313 removed the parallel upvote count that used to sit beside it.
    favorites: favoriteCount('share', slug),
    comments: commentThreadCount(comments, 'share', slug, d.author),
    tags: d.tags ?? [],
    // sow-174: a share still carries no taxonomy PATH, so it still never matches a ?cat= drilldown. That is
    // unchanged. sow-381 adds the pill from the share's own flat topic key, which is a different field.
    categories: d.categories ?? [],
    category: typeof d.category === 'string' && d.category.trim() ? topicLabel(d.category.trim()) : undefined,
    // sow-382: the raw topic key, which joins the taxonomy tokens in `data-cats`. NOT folded into
    // `categories` above: that is a taxonomy PATH and a share does not have one, so giving it a fake one
    // would put a share into breadcrumbs and top-level rollups it does not belong in.
    categoryKey: typeof d.category === 'string' && d.category.trim() ? d.category.trim() : undefined,
    // thumb keeps a branded fallback (the card grid needs every tile imaged); cover stays real-only
    // so detailed rows without an image keep their text-only layout.
    // sow-283: a share pointing at our hosted copy renders it root-relative, so no visitor's browser contacts the
    // original host (and a local preview serves it too).
    thumb: typeof d.image === 'string' && d.image ? shareImageForSite(d.image) : defaultFeatureImage('share'),
    cover: typeof d.image === 'string' && d.image ? shareImageForSite(d.image) : null,
    srcDomain,
  };
}

export interface FeedData {
  contentItems: FeedItem[]; // articles + projects/applets + prompts, PUBLIC only (sow-323 Phase 3: isDiscoverable)
  // sow-323 Phase 3: the published members-only items with their own page (Mode B stubs, not stale). Never rendered
  // for a visitor: a list puts them inside <template data-members-only>, revealed after a paying member signs in.
  membersItems: FeedItem[];
  shareItems: FeedItem[]; // PUBLIC shares only (the scoped SOW-018 reversal, fail closed)
  membersShareCount: number; // published members-only shares (for the aggregate locked card; no titles)
  profiles: CollectionEntry<'profile'>[]; // public member profiles (gbti excluded)
  avatarIndex: AvatarIndex;
}

/** Fetch + normalize everything the feed surfaces need. Build-time only. */
export async function loadFeedItems(): Promise<FeedData> {
  const comments = await getCollection('comment');
  const posts = (await getCollection('post')).filter(isDiscoverable);
  // SOW-022: applets list among projects; their cards link to the running tool via catalogHref.
  const projects = [...(await getCollection('project')), ...(await getCollection('applet'))].filter(isDiscoverable);
  const prompts = (await getCollection('prompt')).filter(isDiscoverable);
  const membersPosts = (await getCollection('post')).filter(isMembersDiscoverable);
  const membersProjects = [...(await getCollection('project')), ...(await getCollection('applet'))].filter(isMembersDiscoverable);
  const membersPrompts = (await getCollection('prompt')).filter(isMembersDiscoverable);
  const allShares = await getCollection('share');
  const shares = allShares.filter((s) => isPublicShare(s.data));
  const membersShareCount = allShares.filter((s) => s.data.status === 'published' && !isPublicShare(s.data)).length;
  const profiles = (await getCollection('profile')).filter(isPublic).filter((p) => p.data.username !== 'gbti');

  const contentItems: FeedItem[] = [
    ...(await Promise.all(posts.map((p) => contentItem(p, 'article', comments)))),
    ...(await Promise.all(projects.map((p) => contentItem(p, 'project', comments)))),
    ...(await Promise.all(prompts.map((p) => contentItem(p, 'prompt', comments)))),
  ];
  const shareItems = shares.map((s) => shareItem(s, comments));
  const membersItems: FeedItem[] = [
    ...(await Promise.all(membersPosts.map((p) => contentItem(p, 'article', comments)))),
    ...(await Promise.all(membersProjects.map((p) => contentItem(p, 'project', comments)))),
    ...(await Promise.all(membersPrompts.map((p) => contentItem(p, 'prompt', comments)))),
  ];

  return { contentItems, membersItems, shareItems, membersShareCount, profiles, avatarIndex: buildAvatarIndex(profiles) };
}
