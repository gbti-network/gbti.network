import { authorDisplay, authorHref, authorAvatar } from './authors';

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

/** An author username -> avatar item, with a sensible fallback when the member has no profile. */
export function authorItem(username: string, index: AvatarIndex): AvatarItem {
  return index.byUsername.get(username) ?? { name: authorDisplay(username), href: authorHref(username), avatar: authorAvatar(username) };
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
