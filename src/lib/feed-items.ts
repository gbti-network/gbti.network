// SOW-136 / sow-131: the shared normalized feed item + its builders, extracted from the homepage so
// the /feeds/ views render the exact same rows. One `FeedItem` per content entry or public share;
// `targetType` keys favorites/upvotes/comments, `kind` labels the card.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { isPublic, isListed, isStub, catalogHref } from './content';
import { buildAvatarIndex, type AvatarIndex } from './avatars';
import { favoriteCount } from './favorites';
import { upvoteCount } from './upvotes';
import { commentThreadCount } from './comments';
import { resolveThumb } from './index-thumb';
import { imageFieldOf } from './content-index.mjs';
import { feedTime, isPublicShare, readMinutes, decodeEntities } from './home-feed.mjs';

export type FeedItem = {
  kind: 'article' | 'product' | 'prompt' | 'share';
  targetType: 'post' | 'product' | 'prompt' | 'share';
  slug: string; // the favorites/upvotes/comments key: content slug, or "<author>/<id>" for a share
  title: string;
  href: string | null;
  external: boolean;
  author: string;
  date: number;
  excerpt?: string;
  stub: boolean;
  favorites: number;
  upvotes: number;
  comments: number;
  tags: string[];
  thumb: string | null; // small square (always resolvable, branded fallback)
  cover: string | null; // wide feed cover (only when the item has a real image)
  srcDomain?: string; // share: the shared link's hostname
  read?: number; // article: minutes
};

async function contentItem(entry: any, kind: 'article' | 'product' | 'prompt', comments: CollectionEntry<'comment'>[]): Promise<FeedItem> {
  const d = entry.data;
  const tt: 'post' | 'product' | 'prompt' = kind === 'article' ? 'post' : kind === 'prompt' ? 'prompt' : 'product';
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
    upvotes: 0,
    comments: commentThreadCount(comments, tt, d.slug, d.author),
    tags: d.tags ?? [],
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
    href: d.url ?? null, // no /shares/ routes until SOW-094; a share clicks through to its source
    external: true,
    author: d.author,
    date: feedTime(d),
    excerpt: d.title && d.shortDescription ? decodeEntities(d.shortDescription) : undefined,
    stub: false,
    favorites: 0,
    upvotes: upvoteCount(slug),
    comments: commentThreadCount(comments, 'share', slug, d.author),
    tags: d.tags ?? [],
    thumb: typeof d.image === 'string' && d.image ? d.image : null,
    cover: typeof d.image === 'string' && d.image ? d.image : null,
    srcDomain,
  };
}

export interface FeedData {
  contentItems: FeedItem[]; // articles + products/applets + prompts (isListed; Mode B stubs included)
  shareItems: FeedItem[]; // PUBLIC shares only (the scoped SOW-018 reversal, fail closed)
  membersShareCount: number; // published members-only shares (for the aggregate locked card; no titles)
  profiles: CollectionEntry<'profile'>[]; // public member profiles (gbti excluded)
  avatarIndex: AvatarIndex;
}

/** Fetch + normalize everything the feed surfaces need. Build-time only. */
export async function loadFeedItems(): Promise<FeedData> {
  const comments = await getCollection('comment');
  const posts = (await getCollection('post')).filter(isListed);
  // SOW-022: applets list among products; their cards link to the running tool via catalogHref.
  const products = [...(await getCollection('product')), ...(await getCollection('applet'))].filter(isListed);
  const prompts = (await getCollection('prompt')).filter(isListed);
  const allShares = await getCollection('share');
  const shares = allShares.filter((s) => isPublicShare(s.data));
  const membersShareCount = allShares.filter((s) => s.data.status === 'published' && !isPublicShare(s.data)).length;
  const profiles = (await getCollection('profile')).filter(isPublic).filter((p) => p.data.username !== 'gbti');

  const contentItems: FeedItem[] = [
    ...(await Promise.all(posts.map((p) => contentItem(p, 'article', comments)))),
    ...(await Promise.all(products.map((p) => contentItem(p, 'product', comments)))),
    ...(await Promise.all(prompts.map((p) => contentItem(p, 'prompt', comments)))),
  ];
  const shareItems = shares.map((s) => shareItem(s, comments));

  return { contentItems, shareItems, membersShareCount, profiles, avatarIndex: buildAvatarIndex(profiles) };
}
