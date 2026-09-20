// sow-222: who the source card points AT. A shared link's sidebar offered "Visit", which opened the same link
// the page already opens, so the one thing a reader might want next, the person who made it, was missing even
// though we already knew who they were: the oEmbed fetch reads `author_name` for the prose line and threw the
// `author_url` beside it away.
//
// Two rules, one module:
//   - EIGHT platforms need no network at all. The creator is in the path of the link the member pasted, so it
//     is a parse, which cannot fail at runtime, cannot time out and adds no fetch surface.
//   - YouTube (and Vimeo, free on the same oEmbed response) carries the channel nowhere in the URL, so the
//     share stores it at publish time and this reads what was stored.
//
// Pure and node-free, the shape of ./video-embed.mjs and ./url-normalize.mjs, so the Astro site and the
// extension reader share one decision instead of hand-mirroring two source cards.
//
// FAIL INVISIBLE. Anything not recognized returns null and the card renders exactly what it renders today.
// A derived URL is member-controlled input: it is built from parts this module validates, never concatenated
// from raw input, and a stored creator url is refused unless it is https on the platform's own host.

/** What the action button says. It names what the click DOES, because the click opens the creator's page
 *  and cannot subscribe or follow for anyone. sow-375: YouTube reads "View Channel" for that reason. */
const PLATFORMS = {
  youtube: { label: 'YouTube', verb: 'View Channel', hosts: ['youtube.com', 'music.youtube.com'] },
  vimeo: { label: 'Vimeo', verb: 'Follow', hosts: ['vimeo.com'] },
  substack: { label: 'Substack', verb: 'Subscribe' },
  x: { label: 'X', verb: 'Follow' },
  bluesky: { label: 'Bluesky', verb: 'Follow' },
  mastodon: { label: 'Mastodon', verb: 'Follow' },
  mixcloud: { label: 'Mixcloud', verb: 'Follow' },
  github: { label: 'GitHub', verb: 'Follow' },
  devto: { label: 'DEV', verb: 'Follow' },
  medium: { label: 'Medium', verb: 'Follow' },
};

// Paths that look like a profile and are not one. Each list is short on purpose: a false positive here is a
// button pointing at a page that is not a person, which is worse than no button at all.
const X_RESERVED = new Set(['i', 'home', 'search', 'explore', 'settings', 'messages', 'notifications', 'compose', 'intent']);
const GITHUB_RESERVED = new Set(['orgs', 'features', 'about', 'pricing', 'marketplace', 'sponsors', 'collections', 'topics', 'explore', 'settings', 'notifications', 'login', 'join', 'blog', 'security', 'readme', 'enterprise', 'apps', 'contact', 'site', 'search', 'trending', 'new', 'codespaces']);

const SUBSTACK_RESERVED = new Set(['open', 'www', 'about', 'help', 'on', 'support']);
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DIGITS_RE = /^\d+$/;

const hostOf = (u) => u.hostname.toLowerCase().replace(/^www\.|^m\./, '');

/** Parse a member-supplied share url, or null when it is not a usable http(s) link. */
function parse(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

/** A stored creator url is only trusted when it is https on the platform's own host. */
function storedCreator(raw, platform) {
  const u = parse(raw);
  if (!u || u.protocol !== 'https:') return null;
  const hosts = PLATFORMS[platform]?.hosts || [];
  const host = hostOf(u);
  if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return u.toString();
}

/**
 * The creator behind a shared link: { url, name, platform, label, verb }, or null when there is none to point
 * at. `stored` carries what the share recorded at publish time (YouTube and Vimeo only).
 */
export function creatorFrom(rawUrl, stored = {}) {
  const u = parse(rawUrl);
  if (!u) return null;
  const host = hostOf(u);
  const seg = u.pathname.split('/').filter(Boolean);
  const stamped = typeof stored?.creatorName === 'string' && stored.creatorName.trim() ? stored.creatorName.trim() : '';
  // A creator with no name recorded is still worth naming: the handle is in the url we just parsed, and a card
  // reading "@pfrazee.com" beside Follow says who it means, where a bare host does not.
  const made = (platform, url, handle = '') => (url
    ? { url, name: stamped || handle || '', platform, label: PLATFORMS[platform].label, verb: PLATFORMS[platform].verb }
    : null);

  // The two that cannot be derived: the channel is nowhere in the url, so the share stores it at publish time.
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    return made('youtube', storedCreator(stored?.creatorUrl, 'youtube'));
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    return made('vimeo', storedCreator(stored?.creatorUrl, 'vimeo'));
  }

  // Everything below is a parse of the url the member already pasted.
  if (host === 'x.com' || host === 'twitter.com') {
    if (seg.length >= 3 && seg[1] === 'status' && HANDLE_RE.test(seg[0]) && !X_RESERVED.has(seg[0].toLowerCase())) {
      return made('x', `https://x.com/${seg[0]}`, `@${seg[0]}`);
    }
    return null;
  }
  if (host === 'bsky.app') {
    if (seg.length >= 2 && seg[0] === 'profile' && /^[A-Za-z0-9][A-Za-z0-9.:-]{0,79}$/.test(seg[1])) {
      return made('bluesky', `https://bsky.app/profile/${seg[1]}`, `@${seg[1]}`);
    }
    return null;
  }
  if (host.endsWith('.substack.com')) {
    const sub = host.slice(0, -'.substack.com'.length);
    // open.substack.com is the reader app, not a publication: its /pub/<name>/p/<slug> carries the real one.
    if (SUBSTACK_RESERVED.has(sub)) {
      if (seg.length >= 2 && seg[0] === 'pub' && HANDLE_RE.test(seg[1])) {
        return made('substack', `https://${seg[1].toLowerCase()}.substack.com/`, `${seg[1].toLowerCase()}.substack.com`);
      }
      return null;
    }
    return made('substack', `https://${host}/`, host);
  }
  if (host === 'mixcloud.com') {
    if (seg.length >= 2 && HANDLE_RE.test(seg[0])) return made('mixcloud', `https://www.mixcloud.com/${seg[0]}/`, seg[0]);
    return null;
  }
  if (host === 'github.com') {
    if (seg.length >= 2 && HANDLE_RE.test(seg[0]) && !GITHUB_RESERVED.has(seg[0].toLowerCase())) {
      return made('github', `https://github.com/${seg[0]}`, seg[0]); // the OWNER profile, one rule for every platform
    }
    return null;
  }
  if (host === 'dev.to') {
    if (seg.length >= 2 && HANDLE_RE.test(seg[0])) return made('devto', `https://dev.to/${seg[0]}`, `@${seg[0]}`);
    return null;
  }
  if (host === 'medium.com') {
    if (seg.length >= 2 && seg[0].startsWith('@') && HANDLE_RE.test(seg[0].slice(1))) {
      return made('medium', `https://medium.com/${seg[0]}`, seg[0]);
    }
    return null;
  }
  if (host.endsWith('.medium.com')) {
    return made('medium', `https://${host}/`, host);
  }

  // MASTODON IS LAST AND ITS RULE IS DELIBERATELY NARROW, because the platform has no fixed host: any site
  // could be an instance, so the only honest tell is the shape of a status url, `/@user/<numeric id>`, with
  // the id numeric. A looser `/@name/` would claim profiles on sites that are not Mastodon at all.
  if (seg.length === 2 && seg[0].startsWith('@') && DIGITS_RE.test(seg[1])) {
    const handle = seg[0].slice(1);
    const local = handle.split('@')[0];
    if (HANDLE_RE.test(local)) return made('mastodon', `https://${host}/@${handle}`, `@${handle}`);
  }
  return null;
}

/**
 * Everything the sidebar source card renders, for both copies of it. The renderer keeps its own favicon
 * service, its own outbound decoration and its own escaping; this owns WHO the card names and WHAT the action
 * says, so the two surfaces cannot drift apart on the decision.
 *
 * Returns null when there is no link to show a card for.
 */
export function sourceCardModel({ url, memberName, creatorUrl = '', creatorName = '' } = {}) {
  const u = parse(url);
  if (!u) return null;
  const host = hostOf(u);
  const who = String(memberName || '').trim();
  const creator = creatorFrom(url, { creatorUrl, creatorName });
  if (!creator) {
    return {
      host,
      name: host,
      credit: who ? `The source ${who} shared this from.` : 'The source of this share.',
      creator: null,
      action: { href: u.toString(), text: 'Visit', title: `Open ${host}` },
    };
  }
  const shown = creator.name || host;
  return {
    host,
    name: shown,
    credit: who ? `On ${creator.label}, shared by ${who}.` : `On ${creator.label}.`,
    creator,
    // The verb is what the platform's own audience says. The action OPENS the creator's page, where the
    // reader subscribes or follows themselves, so the title says open rather than implying one click does it.
    action: { href: creator.url, text: creator.verb, title: `Open ${shown} on ${creator.label}` },
  };
}
