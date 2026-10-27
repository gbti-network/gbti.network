// sow-483 (owner, 2026-10-27): the ```audio block can play a SoundCloud, Spotify or Apple Podcasts recording in the
// provider's own player. This module turns the page link a member copies from the service into the player address,
// and refuses everything else, so a block can only ever frame these three players. Pure and shared: the site's remark
// pass and markdown.mjs (WorkBench preview, extension reader) render through content-blocks.mjs, which calls it.
//
//   soundcloud: https://soundcloud.com/<account>/<track>          a track (166 px)
//   soundcloud: https://soundcloud.com/<account>/sets/<playlist>  a playlist (300 px)
//   spotify:    https://open.spotify.com/episode/<id>             an episode, or /show/<id> a show (152 px)
//   apple:      https://podcasts.apple.com/<cc>/podcast/<name>/id<show>?i=<episode>   an episode (175 px), or a show (450 px)

export const AUDIO_PROVIDERS = ['soundcloud', 'spotify', 'apple'];

export const PROVIDER_NAMES = { soundcloud: 'SoundCloud', spotify: 'Spotify', apple: 'Apple Podcasts' };

/** The words a link out gets when the author leaves them blank. */
export const DEFAULT_LINK_LABELS = { soundcloud: 'Listen on SoundCloud', spotify: 'Listen on Spotify', apple: 'Open in Apple Podcasts' };

// SoundCloud's own sections, which share the /<first>/<second> shape with a track but are not one.
const SOUNDCLOUD_RESERVED = new Set(['discover', 'search', 'charts', 'stations', 'you', 'upload', 'settings', 'messages',
  'notifications', 'pages', 'people', 'popular', 'terms-of-use', 'imprint', 'jobs', 'mobile', 'pro', 'feed', 'player', 'widget']);

const parse = (raw) => {
  try { const u = new URL(String(raw ?? '').trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
};

/**
 * The player for a provider page link: `{ provider, kind, page, src, height }`, or null when the link is not one this
 * provider's player can show. `page` is the canonical page address (query and tracking dropped), used for the
 * cross-post link and the default link out.
 */
export function audioEmbed(provider, raw) {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (provider === 'soundcloud') {
    if (host !== 'soundcloud.com') return null;
    const [account, second, third, fourth] = parts;
    if (!account || SOUNDCLOUD_RESERVED.has(account.toLowerCase()) || !/^[A-Za-z0-9_-]+$/.test(account)) return null;
    let kind = null;
    let pagePath = null;
    if (second === 'sets' && third && /^[A-Za-z0-9_-]+$/.test(third) && (!fourth || /^s-[A-Za-z0-9]+$/.test(fourth)) && parts.length <= 4) {
      kind = 'playlist'; pagePath = parts.join('/');
    } else if (second && second !== 'sets' && /^[A-Za-z0-9_-]+$/.test(second) && (!third || /^s-[A-Za-z0-9]+$/.test(third)) && parts.length <= 3
      && !['tracks', 'albums', 'reposts', 'likes', 'followers', 'following', 'comments', 'popular-tracks'].includes(second)) {
      kind = 'track'; pagePath = parts.join('/');
    }
    if (!kind) return null;
    const page = `https://soundcloud.com/${pagePath}`;
    const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}&color=%231f9e5f&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`;
    return { provider, kind, page, src, height: kind === 'playlist' ? 300 : 166 };
  }
  if (provider === 'spotify') {
    if (host !== 'open.spotify.com') return null;
    const p = /^intl-[a-z-]+$/i.test(parts[0] || '') ? parts.slice(1) : parts;
    const [kind, id] = p;
    if (!['episode', 'show'].includes(kind) || !/^[A-Za-z0-9]{22}$/.test(id || '') || p.length !== 2) return null;
    return { provider, kind, page: `https://open.spotify.com/${kind}/${id}`, src: `https://open.spotify.com/embed/${kind}/${id}`, height: 152 };
  }
  if (provider === 'apple') {
    if (host !== 'podcasts.apple.com') return null;
    const [cc, word, ...rest] = parts;
    if (!/^[a-z]{2}$/i.test(cc || '') || word !== 'podcast') return null;
    const idSeg = rest[rest.length - 1] || '';
    const name = rest.length === 2 ? rest[0] : null;
    if (!/^id\d+$/.test(idSeg) || rest.length > 2 || (name !== null && !/^[A-Za-z0-9%_.-]+$/.test(name))) return null;
    const episode = u.searchParams.get('i');
    if (episode !== null && !/^\d+$/.test(episode)) return null;
    const pathPart = `${cc.toLowerCase()}/podcast/${name ? `${name}/` : ''}${idSeg}${episode ? `?i=${episode}` : ''}`;
    return { provider, kind: episode ? 'episode' : 'show', page: `https://podcasts.apple.com/${pathPart}`, src: `https://embed.podcasts.apple.com/${pathPart}`, height: episode ? 175 : 450 };
  }
  return null;
}

// Hosts a member might paste into the wrong line, so the warning can say what the link is.
const KNOWN_HOSTS = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'], [/(^|\.)vimeo\.com$/, 'Vimeo'], [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)mixcloud\.com$/, 'Mixcloud'], [/(^|\.)soundcloud\.com$/, 'SoundCloud'], [/(^|\.)spotify\.com$|^spotify\.link$|^spoti\.fi$/, 'Spotify'],
  [/(^|\.)apple\.com$/, 'Apple'],
];

/** Why a pasted link cannot be played by this provider, in a sentence an author can act on. */
export function embedProblem(provider, raw) {
  const name = PROVIDER_NAMES[provider] || 'this service';
  const wants = { soundcloud: 'a SoundCloud track or playlist link', spotify: 'a Spotify episode or show link', apple: 'an Apple Podcasts episode or show link' }[provider] || 'a link';
  const u = parse(raw);
  if (!u) return `"${String(raw ?? '').trim()}" is not a web address. Paste ${wants}.`;
  const host = u.hostname.toLowerCase();
  if (/^on\.soundcloud\.com$|^spotify\.link$|^spoti\.fi$/.test(host)) return `This is a short link. Open it, then copy the full ${name} address from the page.`;
  const known = KNOWN_HOSTS.find(([re]) => re.test(host.replace(/^(www|m)\./, '')));
  if (known && known[1] !== name && !(provider === 'apple' && known[1] === 'Apple')) {
    const video = ['YouTube', 'Vimeo', 'TikTok'].includes(known[1]) ? ', or add the video with a Video block' : '';
    return `This is a ${known[1]} link. Paste ${wants}${video}.`;
  }
  return `This link is not ${wants.replace(/ link$/, '')}. Paste ${wants}.`;
}
