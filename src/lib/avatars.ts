import { authorDisplay, authorHref, authorAvatar } from './authors';
import { isBotLogin } from './bot-login.mjs';
export { isBotLogin };

/** One avatar in a stack: a person to credit on a card or post. */
export interface AvatarItem {
  name: string;
  href: string;
  avatar?: string;
}

interface ProfileLike {
  data: { username: string; displayName?: string; avatar?: string; links?: { github?: string } };
}
interface ContributorLike {
  login: string;
  commit?: string;
  url?: string;
  class?: string;
}
interface CommentLike {
  data: { author: string; targetType: string; targetSlug: string };
}

/** Canonical GitHub avatar for a login. GitHub serves every account's avatar at `github.com/<login>.png`
 *  and 404s for an unknown login (so the Avatar component falls back to its letter disc). Use this for a
 *  commit author or contributor who is not a network member (no profile gravatar of our own to show). */
export function githubAvatarUrl(login?: string | null, size = 80): string | undefined {
  if (!login) return undefined;
  // A GitHub App's bot account (`<app>[bot]`, e.g. our gbti-network-publisher[bot], which authors every commit
  // the network publishes) has NO avatar at this address: GitHub 404s it, and a site crawl reported one broken
  // image per article history on 2026-09-21. No URL is better than a dead one; the Avatar falls back to letters.
  if (isBotLogin(login)) return undefined;
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}

/** Extract a lowercase github login from a profile links.github value (a URL or a bare handle). */
export function githubLogin(githubLink?: string): string | undefined {
  if (!githubLink) return undefined;
  const m = githubLink.match(/github\.com\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const handle = githubLink.trim().replace(/^@/, '');
  return /^[a-z0-9-]+$/i.test(handle) ? handle.toLowerCase() : undefined;
}

export interface AvatarIndex {
  byUsername: Map<string, AvatarItem>;
  byLogin: Map<string, AvatarItem>;
}

/**
 * Index every profile by its username AND by its github login (parsed from links.github), so a
 * contributor entry (keyed on github login) and an author or commenter (keyed on username) both
 * resolve to the same avatar. Build this once per page and pass it to the cards.
 */
export function buildAvatarIndex(profiles: ProfileLike[]): AvatarIndex {
  const byUsername = new Map<string, AvatarItem>();
  const byLogin = new Map<string, AvatarItem>();
  for (const p of profiles) {
    const d = p.data;
    const item: AvatarItem = { name: d.displayName || d.username, href: authorHref(d.username), avatar: d.avatar };
    byUsername.set(d.username, item);
    const login = githubLogin(d.links?.github);
    if (login) byLogin.set(login, item);
  }
  return { byUsername, byLogin };
}

/**
 * An author username -> avatar item, with a sensible fallback when the member has no profile.
 *
 * sow-362: the fallback carries NO href. It fires exactly when the username is absent from the profile index,
 * which is the same condition as having no page at /members/<username>/, so the href it used to return was a
 * link to a 404 (measured live 2026-09-18 on a comment author and a share author). Callers that render
 * `item.href` (StackedAvatars, ContributionCredits) get an anchor with no href, which the one global
 * `a:not([href])` rule in gbti-v3.css renders as plain text.
 */
export function authorItem(username: string, index: AvatarIndex): AvatarItem {
  return index.byUsername.get(username) ?? { name: authorDisplay(username), avatar: authorAvatar(username) };
}

/** Resolve the frontmatter contributors[] (github logins) to deduped avatar items. */
export function contributorItems(contributors: ContributorLike[] | undefined, index: AvatarIndex): AvatarItem[] {
  const out: AvatarItem[] = [];
  const seen = new Set<string>();
  for (const c of contributors ?? []) {
    const login = (c.login ?? '').toLowerCase();
    if (!login || seen.has(login)) continue;
    seen.add(login);
    out.push(index.byLogin.get(login) ?? { name: c.login, href: `https://github.com/${c.login}`, avatar: githubAvatarUrl(c.login) });
  }
  return out;
}

/** Distinct commenter avatar items for a target (post/product/prompt slug). */
export function commenterItems(
  comments: CommentLike[],
  targetType: string,
  targetSlug: string,
  index: AvatarIndex,
): AvatarItem[] {
  const out: AvatarItem[] = [];
  const seen = new Set<string>();
  for (const c of comments) {
    if (c.data.targetType !== targetType || c.data.targetSlug !== targetSlug) continue;
    const u = c.data.author;
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(authorItem(u, index));
  }
  return out;
}

/**
 * Compose the stacked-avatar list for a content item: the primary author first, then accepted
 * contributors, then commenters, deduped. This is what the article and product cards render.
 */
export function avatarStack(opts: {
  author: string;
  contributors?: ContributorLike[];
  comments?: CommentLike[];
  targetType?: string;
  targetSlug?: string;
  index: AvatarIndex;
}): AvatarItem[] {
  const { author, contributors = [], comments = [], targetType = 'post', targetSlug = '', index } = opts;
  const out: AvatarItem[] = [];
  const seen = new Set<string>();
  const push = (it: AvatarItem) => {
    const key = `${it.href}|${it.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };
  push(authorItem(author, index));
  for (const it of contributorItems(contributors, index)) push(it);
  if (targetSlug) for (const it of commenterItems(comments, targetType, targetSlug, index)) push(it);
  return out;
}
